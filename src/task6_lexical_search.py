r"""
Task 6 — Lexical / Sparse Search (BM25 + TF-IDF).   [Role 4]

Run:
    python -m src.task6_lexical_search                       # demo
    python -m src.task6_lexical_search -q "census date" --method tfidf
    python -m src.task6_lexical_search --compare             # BM25 vs TF-IDF

-----------------------------------------------------------------------------
DESIGN DECISIONS
-----------------------------------------------------------------------------

1. The lexical corpus is read back OUT of ChromaDB, not re-chunked from disk.
   This is the single most important detail for Task 7. RRF fuses two ranked
   lists by matching identical documents; if BM25 chunked the markdown slightly
   differently from Task 4, no chunk would ever appear in both lists and RRF
   would degenerate into "concatenate the two lists". Reading `collection.get()`
   guarantees byte-identical chunk text and identical metadata on both sides.
   If chroma_db/ does not exist yet we fall back to calling Task 4's
   `chunk_documents()` directly — same code path, so still identical text.

2. BM25Okapi with k1=1.5, b=0.75 (the standard defaults).
     score(q,d) = Σ IDF(qi) · tf(qi,d)·(k1+1) / (tf(qi,d) + k1·(1-b+b·|d|/avgdl))
   - k1 = 1.5 controls term saturation: the 10th occurrence of "fee" in a chunk
     adds far less than the 2nd. Our chunks are short (≤800 chars) so saturation
     rarely binds, but it protects against boilerplate-heavy PDF conversions.
   - b = 0.75 is length normalisation. Our chunks are near-uniform in length by
     construction, so this is close to a no-op — a deliberate consequence of the
     fixed-size chunking in Task 4.

3. Unicode-aware tokenisation instead of `.split()`.
   `"fees."`, `"fees,"` and `"fees"` must be the same token or BM25 misses
   obvious keyword matches, and `[\w]+` with re.UNICODE keeps Vietnamese
   diacritics intact ("học" stays one token, it is not stripped to "h c").
   We do NOT do Vietnamese word segmentation (underthesea): our corpus is
   English, so syllable-level tokens are the right granularity and adding a
   segmenter would only slow start-up.

4. TF-IDF is provided as a second, comparable ranker (+bonus).
   Cosine over scikit-learn TF-IDF vectors with sublinear_tf=True and 1-2 grams.
   The practical difference to demo: TF-IDF has no length normalisation term and
   no term saturation, so it over-rewards long chunks that repeat a keyword;
   BM25 wins on short factual queries like "census date". Use --compare to show
   this live.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

STANDARDIZED_DIR = Path(__file__).parent.parent / "data" / "standardized"

# BM25 hyper-parameters (see design note 2).
BM25_K1 = 1.5
BM25_B = 0.75

DEFAULT_METHOD = "bm25"     # "bm25" | "tfidf"

# Populated lazily by get_corpus(); kept as a module-level name so other tasks
# and the tests can inspect it.
CORPUS: list[dict] = []

_bm25_index = None
_tfidf_vectorizer = None
_tfidf_matrix = None

# Unicode word tokens: letters (incl. Vietnamese diacritics) and digits.
_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


# =============================================================================
# CORPUS
# =============================================================================

def _load_corpus_from_chroma() -> list[dict]:
    """Read the exact chunks Task 4 indexed, so RRF keys line up."""
    from .task4_chunking_indexing import get_collection

    collection = get_collection(create=False)
    if collection.count() == 0:
        return []
    payload = collection.get(include=["documents", "metadatas"])
    return [
        {"content": document, "metadata": dict(metadata or {})}
        for document, metadata in zip(payload["documents"], payload["metadatas"])
    ]


def _load_corpus_from_disk() -> list[dict]:
    """Fallback when chroma_db/ has not been built yet — same chunking code."""
    from .task4_chunking_indexing import chunk_documents, load_documents

    return [
        {"content": chunk["content"], "metadata": chunk["metadata"]}
        for chunk in chunk_documents(load_documents())
    ]


def get_corpus(force_reload: bool = False) -> list[dict]:
    """Return (and cache) the lexical corpus."""
    global CORPUS
    if CORPUS and not force_reload:
        return CORPUS

    corpus: list[dict] = []
    try:
        corpus = _load_corpus_from_chroma()
    except Exception:
        corpus = []
    if not corpus:
        corpus = _load_corpus_from_disk()

    CORPUS = corpus
    return CORPUS


def tokenize(text: str) -> list[str]:
    """Lowercase + unicode word tokens. Same function at index and query time."""
    return _TOKEN_PATTERN.findall(text.lower())


# =============================================================================
# BM25
# =============================================================================

def build_bm25_index(corpus: list[dict]):
    """Build a BM25Okapi index over the corpus."""
    from rank_bm25 import BM25Okapi

    tokenized_corpus = [tokenize(document["content"]) for document in corpus]
    # BM25Okapi refuses an empty corpus, so guard the caller instead.
    return BM25Okapi(tokenized_corpus, k1=BM25_K1, b=BM25_B)


def _get_bm25():
    global _bm25_index
    if _bm25_index is None:
        corpus = get_corpus()
        if not corpus:
            return None
        _bm25_index = build_bm25_index(corpus)
    return _bm25_index


def bm25_search(query: str, top_k: int = 10) -> list[dict]:
    bm25 = _get_bm25()
    if bm25 is None:
        return []

    corpus = get_corpus()
    scores = bm25.get_scores(tokenize(query))

    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    results: list[dict] = []
    for index in ranked[:top_k]:
        # BM25 gives 0 to chunks sharing no query term — those are noise, drop them.
        if scores[index] <= 0:
            continue
        results.append(
            {
                "content": corpus[index]["content"],
                "score": round(float(scores[index]), 4),
                "metadata": corpus[index]["metadata"],
            }
        )
    return results


# =============================================================================
# TF-IDF (alternative sparse ranker)
# =============================================================================

def build_tfidf_index(corpus: list[dict]):
    from sklearn.feature_extraction.text import TfidfVectorizer

    vectorizer = TfidfVectorizer(
        tokenizer=tokenize,
        lowercase=True,
        ngram_range=(1, 2),     # bigrams catch "census date", "tuition fee"
        sublinear_tf=True,      # 1 + log(tf): TF-IDF's poor-man's saturation
        min_df=1,
        token_pattern=None,     # we supply our own tokenizer
    )
    matrix = vectorizer.fit_transform([document["content"] for document in corpus])
    return vectorizer, matrix


def _get_tfidf():
    global _tfidf_vectorizer, _tfidf_matrix
    if _tfidf_vectorizer is None:
        corpus = get_corpus()
        if not corpus:
            return None, None
        _tfidf_vectorizer, _tfidf_matrix = build_tfidf_index(corpus)
    return _tfidf_vectorizer, _tfidf_matrix


def tfidf_search(query: str, top_k: int = 10) -> list[dict]:
    vectorizer, matrix = _get_tfidf()
    if vectorizer is None:
        return []

    from sklearn.metrics.pairwise import cosine_similarity

    corpus = get_corpus()
    scores = cosine_similarity(vectorizer.transform([query]), matrix)[0]

    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    results: list[dict] = []
    for index in ranked[:top_k]:
        if scores[index] <= 0:
            continue
        results.append(
            {
                "content": corpus[index]["content"],
                "score": round(float(scores[index]), 4),
                "metadata": corpus[index]["metadata"],
            }
        )
    return results


# =============================================================================
# PUBLIC INTERFACE
# =============================================================================

def lexical_search(query: str, top_k: int = 10, method: str = DEFAULT_METHOD) -> list[dict]:
    """
    Sparse keyword retrieval.

    Args:
        query: The user question.
        top_k: Maximum number of chunks to return.
        method: "bm25" (default) or "tfidf".

    Returns:
        List of {'content': str, 'score': float, 'metadata': dict},
        sorted by score descending. Chunks with score 0 are omitted.
    """
    if not query or not query.strip():
        return []
    if method == "tfidf":
        return tfidf_search(query, top_k)
    if method == "bm25":
        return bm25_search(query, top_k)
    raise ValueError(f"Unknown lexical method: {method!r} (use 'bm25' or 'tfidf')")


def reset_indexes() -> None:
    """Drop cached indexes — call after reindexing the corpus in Task 4."""
    global CORPUS, _bm25_index, _tfidf_vectorizer, _tfidf_matrix
    CORPUS = []
    _bm25_index = None
    _tfidf_vectorizer = None
    _tfidf_matrix = None


# =============================================================================
# CLI
# =============================================================================

def _show(results: list[dict], label: str) -> None:
    print(f"\n{label}")
    if not results:
        print("  (no keyword overlap with the corpus)")
    for i, hit in enumerate(results, 1):
        meta = hit["metadata"]
        print(f"  {i}. [{hit['score']:.4f}] {meta.get('source', '?')} | {meta.get('section', '')}")
        print(f"     {hit['content'][:150].replace(chr(10), ' ')}...")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Lexical (sparse) search demo")
    parser.add_argument("-q", "--query", default="tuition fee payment methods")
    parser.add_argument("-k", "--top-k", type=int, default=5)
    parser.add_argument("--method", choices=["bm25", "tfidf"], default=DEFAULT_METHOD)
    parser.add_argument("--compare", action="store_true", help="BM25 vs TF-IDF side by side")
    args = parser.parse_args()

    corpus = get_corpus()
    print(f"Corpus: {len(corpus)} chunks (k1={BM25_K1}, b={BM25_B})")
    print(f"Query : {args.query}")

    if args.compare:
        _show(lexical_search(args.query, args.top_k, "bm25"), "--- BM25 ---")
        _show(lexical_search(args.query, args.top_k, "tfidf"), "--- TF-IDF ---")
    else:
        _show(lexical_search(args.query, args.top_k, args.method), f"--- {args.method.upper()} ---")
