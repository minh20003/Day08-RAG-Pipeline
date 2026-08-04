"""
Task 5 — Semantic Search (Dense Retrieval) + HyDE.   [Role 3]

Run:
    python -m src.task5_semantic_search                     # demo queries
    python -m src.task5_semantic_search --calibrate         # threshold calibration
    python -m src.task5_semantic_search -q "hoc phi" --hyde

-----------------------------------------------------------------------------
DESIGN DECISIONS
-----------------------------------------------------------------------------

1. Score = 1 - cosine_distance, kept on the raw cosine scale.
   Chroma's collection is created with `hnsw:space = cosine` and our vectors are
   L2-normalised (see embedding_client), so `1 - distance` is a genuine cosine
   similarity in [0, 1]. We deliberately do NOT min-max rescale it: Task 9
   compares this exact number against SCORE_THRESHOLD to decide whether to fall
   back to PageIndex. Rescaling per query would make that threshold meaningless.

2. No instruction prefix on the query.
   bge-m3 is a symmetric retriever. Adding the bge-v1.5-style prefix
   ("Represent this sentence for searching relevant passages:") actually hurts
   bge-m3 because the same string was never prepended at index time.

3. HyDE is opt-in, not always-on.
   HyDE (Gao et al. 2022) asks an LLM for a *hypothetical answer* and searches
   with that instead of the question. It helps when the question and the
   document use different registers ("Bao giờ phải đóng tiền?" vs "Payment is
   due 14 days before census date"), but it costs one LLM call of latency per
   query and can hallucinate the query away from the corpus. So:
       - default: plain dense search (fast, deterministic)
       - `use_hyde=True`: run BOTH the original query and the hypothetical doc,
         then keep, per chunk, the MAX of the two cosine scores.
   Taking the max (rather than fusing ranks) keeps the output on the cosine
   scale, so the Task 9 fallback threshold still works with HyDE turned on.
   If the LLM call fails for any reason we silently degrade to plain search.
"""

from __future__ import annotations

import argparse
import os

from dotenv import load_dotenv

load_dotenv()

from .embedding_client import embed_query
from .task4_chunking_indexing import COLLECTION_NAME, get_collection

# LLM used only for the HyDE hypothetical document. Override in .env.
HYDE_MODEL = os.getenv("HYDE_MODEL") or os.getenv("LLM_MODEL", "openai/gpt-4o-mini")
HYDE_MAX_TOKENS = 200

_collection = None


def _collection_handle():
    """Lazy, cached Chroma handle so repeated searches do not reopen the DB."""
    global _collection
    if _collection is None:
        _collection = get_collection(create=False)
    return _collection


# =============================================================================
# CORE DENSE SEARCH
# =============================================================================

def _query_by_vector(vector: list[float], top_k: int) -> list[dict]:
    """One Chroma ANN lookup -> normalised result dicts."""
    try:
        collection = _collection_handle()
    except Exception as error:
        print(f"⚠ Vector store not available ({error}). Run Task 4 first.")
        return []

    if collection.count() == 0:
        return []

    raw = collection.query(
        query_embeddings=[vector],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    results: list[dict] = []
    for document, metadata, distance in zip(
        raw["documents"][0], raw["metadatas"][0], raw["distances"][0]
    ):
        # cosine distance -> cosine similarity, clamped to [0, 1]
        score = max(0.0, min(1.0, 1.0 - float(distance)))
        results.append(
            {
                "content": document,
                "score": round(score, 4),
                "metadata": dict(metadata or {}),
            }
        )
    return results


def semantic_search(query: str, top_k: int = 10, use_hyde: bool = False) -> list[dict]:
    """
    Dense retrieval over the ChromaDB index built in Task 4.

    Args:
        query: The user question.
        top_k: Maximum number of chunks to return.
        use_hyde: Also search with an LLM-generated hypothetical answer and keep
            the best score per chunk.

    Returns:
        List of {'content': str, 'score': float, 'metadata': dict},
        sorted by cosine similarity descending.
    """
    if not query or not query.strip():
        return []

    # Do not spend an embedding API call when Task 4 has not built the vector
    # index yet. This also keeps the public search contract stable: an absent
    # store means no results, not a provider-key exception.
    try:
        if _collection_handle().count() == 0:
            return []
    except Exception as error:
        print(f'⚠ Vector store not available ({error}). Run Task 4 first.')
        return []

    results = _query_by_vector(embed_query(query), top_k)

    if use_hyde:
        hypothetical = generate_hyde_document(query)
        if hypothetical:
            hyde_results = _query_by_vector(embed_query(hypothetical), top_k)
            results = _merge_by_max_score(results, hyde_results)

    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:top_k]


def _merge_by_max_score(primary: list[dict], secondary: list[dict]) -> list[dict]:
    """
    Union two result lists, keeping the higher cosine score for chunks that
    appear in both. Output stays on the cosine scale (unlike RRF).
    """
    merged: dict[str, dict] = {}
    for item in primary + secondary:
        key = item["content"]
        existing = merged.get(key)
        if existing is None or item["score"] > existing["score"]:
            merged[key] = dict(item)
    return list(merged.values())


# =============================================================================
# HyDE — Hypothetical Document Embeddings
# =============================================================================

HYDE_SYSTEM_PROMPT = (
    "You write a short, plausible passage that would appear in an official "
    "university policy document or campus news article and that would answer the "
    "user's question. Write 2-4 sentences in the same style as a policy document. "
    "Use concrete nouns the source document would use (fees, census date, "
    "scholarship, accommodation, library). Do not say you are unsure, do not add "
    "any preamble — output only the passage. Write in English even if the "
    "question is in Vietnamese, because the source corpus is in English."
)


def generate_hyde_document(query: str) -> str:
    """
    Ask an LLM for a hypothetical answer passage. Returns "" on any failure so
    the caller can fall back to plain dense search.
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key or api_key.startswith("sk-or-v1-..."):
        return ""

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")
        response = client.chat.completions.create(
            model=HYDE_MODEL,
            messages=[
                {"role": "system", "content": HYDE_SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            temperature=0.2,     # low: we want a typical passage, not a creative one
            max_tokens=HYDE_MAX_TOKENS,
        )
        return (response.choices[0].message.content or "").strip()
    except Exception as error:
        print(f"⚠ HyDE unavailable ({type(error).__name__}: {error}) — plain dense search.")
        return ""


# =============================================================================
# THRESHOLD CALIBRATION HELPER (feeds Task 9's SCORE_THRESHOLD)
# =============================================================================

IN_DOMAIN_QUERIES = [
    "What is the tuition fee at RMIT Vietnam?",
    "How do I book a library study room?",
    "What scholarships are available for international students?",
    "How do I pay my student fees?",
    "Học phí tại RMIT Vietnam là bao nhiêu?",
    "Điều kiện xin học bổng là gì?",
]

OUT_OF_DOMAIN_QUERIES = [
    "xyzabc123nonsense",
    "How do I replace the timing belt on a 2004 Honda Civic?",
    "What is the capital of Iceland?",
    "Recipe for sourdough starter",
    "asdkjhasd qwe zxc",
]


def calibrate_threshold() -> dict:
    """
    Measure the top-1 cosine score for questions the corpus CAN answer versus
    questions it cannot, and suggest a fallback threshold in between.
    """
    print("=" * 70)
    print("Threshold calibration — top-1 cosine score per query")
    print("=" * 70)

    def measure(queries: list[str], label: str) -> list[float]:
        scores = []
        print(f"\n{label}")
        for query in queries:
            hits = semantic_search(query, top_k=1)
            score = hits[0]["score"] if hits else 0.0
            scores.append(score)
            print(f"  {score:.4f}  {query[:60]}")
        return scores

    in_scores = measure(IN_DOMAIN_QUERIES, "IN-DOMAIN (should stay hybrid)")
    out_scores = measure(OUT_OF_DOMAIN_QUERIES, "OUT-OF-DOMAIN (should fall back)")

    if not in_scores or not out_scores:
        return {}

    lowest_in = min(in_scores)
    highest_out = max(out_scores)
    suggested = round((lowest_in + highest_out) / 2, 3)

    print("\n" + "-" * 70)
    print(f"  lowest in-domain  top-1 : {lowest_in:.4f}")
    print(f"  highest out-domain top-1: {highest_out:.4f}")
    print(f"  → suggested SCORE_THRESHOLD for Task 9: {suggested}")
    if highest_out >= lowest_in:
        print("  ⚠ The two groups overlap — no clean threshold. Widen the corpus or")
        print("    add more out-of-domain probes before trusting this number.")
    print("-" * 70)
    return {
        "in_domain": in_scores,
        "out_of_domain": out_scores,
        "suggested_threshold": suggested,
    }


# =============================================================================
# CLI
# =============================================================================

def _demo(query: str, top_k: int, use_hyde: bool) -> None:
    print(f"\nQuery: {query}   (hyde={use_hyde}, collection={COLLECTION_NAME})")
    print("-" * 70)
    for i, hit in enumerate(semantic_search(query, top_k=top_k, use_hyde=use_hyde), 1):
        meta = hit["metadata"]
        print(f"  {i}. [{hit['score']:.4f}] {meta.get('source', '?')} | {meta.get('section', '')}")
        print(f"     {hit['content'][:160].replace(chr(10), ' ')}...")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dense semantic search demo")
    parser.add_argument("-q", "--query", help="single query to run")
    parser.add_argument("-k", "--top-k", type=int, default=5)
    parser.add_argument("--hyde", action="store_true", help="enable HyDE expansion")
    parser.add_argument("--calibrate", action="store_true", help="threshold calibration")
    args = parser.parse_args()

    if args.calibrate:
        calibrate_threshold()
    elif args.query:
        _demo(args.query, args.top_k, args.hyde)
    else:
        for demo_query in [
            "What is the tuition fee at RMIT Vietnam?",
            "Làm sao để đặt phòng học nhóm ở thư viện?",
            "scholarship eligibility for international students",
        ]:
            _demo(demo_query, args.top_k, args.hyde)
