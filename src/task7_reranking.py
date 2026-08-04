"""
Task 7 — Reranking: RRF (primary), MMR and cross-encoder.   [Role 4]

Run:
    python -m src.task7_reranking                       # RRF demo on a real query
    python -m src.task7_reranking -q "library booking" --method mmr

-----------------------------------------------------------------------------
DESIGN DECISIONS
-----------------------------------------------------------------------------

1. RRF is the primary fusion method.
       RRF(d) = Σ_r  1 / (k + rank_r(d))          with k = 60
   Dense cosine (0-1) and BM25 (unbounded, corpus-dependent) live on completely
   different scales, so you cannot simply add or average them — a BM25 score of
   12.4 is not "better" than a cosine of 0.71. RRF throws the magnitudes away and
   fuses RANKS only, which is exactly why it needs no tuning and no calibration.
   k = 60 (Cormack et al., 2009) flattens the difference between rank 1 and
   rank 2 (1/61 vs 1/62) so a chunk that both retrievers like beats a chunk that
   only one retriever loves — the whole point of hybrid search.

2. ⚠ RRF scores are NOT similarities — never threshold on them.
   With k=60, the best possible fused score is ~1/61 = 0.0164 for a single list
   and ~0.0328 for two, REGARDLESS of whether the content is relevant. A garbage
   query still produces a "top" result with the same 0.03. This is the trap
   described in Task 9's docstring. That is why every fused item here also keeps
   `retriever_scores` (the original cosine / BM25 values) and
   `dense_score` — Task 9 must threshold on the raw cosine, not on `score`.

3. Dedupe key = (source, chunk_index), not the raw text.
   Content strings can differ by trailing whitespace between retrievers; an ID
   built from metadata is stable. We fall back to the content string only when
   metadata is missing (e.g. the unit tests' dummy candidates).

4. MMR and cross-encoder are implemented too, but not on the default path.
   - MMR (λ=0.7) trades relevance for diversity; useful when the top-5 are five
     near-duplicate paragraphs of the same fee table. It needs embeddings, so it
     costs API calls at query time.
   - Cross-encoder (Jina reranker v2 multilingual) is the highest-quality option
     but needs JINA_API_KEY and one more network round-trip. Without a key it
     degrades gracefully to the incoming order rather than crashing.
"""

from __future__ import annotations

import argparse
import os
from typing import Optional, Sequence

from dotenv import load_dotenv

load_dotenv()

RRF_K = 60                 # Smoothing constant from the original RRF paper.
DEFAULT_METHOD = "rrf"
JINA_MODEL = "jina-reranker-v2-base-multilingual"


# =============================================================================
# Helpers
# =============================================================================

def _dedupe_key(item: dict) -> str:
    """Stable identity for a chunk across different retrievers."""
    metadata = item.get("metadata") or {}
    source = metadata.get("source")
    chunk_index = metadata.get("chunk_index")
    if source is not None and chunk_index is not None:
        return f"{source}::{chunk_index}"
    return (item.get("content") or "")[:400]


def _is_list_of_lists(candidates: Sequence) -> bool:
    return bool(candidates) and isinstance(candidates[0], (list, tuple))


# =============================================================================
# RRF — Reciprocal Rank Fusion
# =============================================================================

def rerank_rrf(
    ranked_lists: list[list[dict]],
    top_k: int = 5,
    k: int = RRF_K,
    list_names: Optional[list[str]] = None,
) -> list[dict]:
    """
    Fuse several ranked lists into one.

    Args:
        ranked_lists: One list per retriever, each already sorted best-first.
        top_k: Number of fused results to return.
        k: Smoothing constant (60).
        list_names: Optional labels used to fill `retriever_scores`.

    Returns:
        top_k items sorted by RRF score descending. Each item keeps:
            'score'            -> the fused RRF score (rank-based, NOT a similarity)
            'retriever_scores' -> {'dense': 0.71, 'lexical': 12.4} original scores
            'dense_score'      -> convenience copy for Task 9's threshold check
    """
    if not ranked_lists:
        return []
    if list_names is None:
        # Two lists is the normal hybrid case: dense first, lexical second.
        default_names = ["dense", "lexical", "third", "fourth"]
        list_names = [
            default_names[i] if i < len(default_names) else f"ranker_{i}"
            for i in range(len(ranked_lists))
        ]

    fused_scores: dict[str, float] = {}
    payloads: dict[str, dict] = {}
    original_scores: dict[str, dict[str, float]] = {}

    for list_index, ranked_list in enumerate(ranked_lists):
        name = list_names[list_index]
        for rank, item in enumerate(ranked_list or [], start=1):
            key = _dedupe_key(item)
            fused_scores[key] = fused_scores.get(key, 0.0) + 1.0 / (k + rank)
            original_scores.setdefault(key, {})[name] = float(item.get("score", 0.0))
            # Keep the payload from the first retriever that saw this chunk.
            payloads.setdefault(key, item)

    ordered = sorted(fused_scores.items(), key=lambda pair: pair[1], reverse=True)

    results: list[dict] = []
    for key, fused in ordered[:top_k]:
        item = dict(payloads[key])
        item["score"] = round(fused, 6)
        item["rrf_score"] = round(fused, 6)
        item["retriever_scores"] = original_scores.get(key, {})
        item["dense_score"] = original_scores.get(key, {}).get("dense", 0.0)
        results.append(item)
    return results


# =============================================================================
# MMR — Maximal Marginal Relevance
# =============================================================================

def rerank_mmr(
    query_embedding: list[float],
    candidates: list[dict],
    top_k: int = 5,
    lambda_param: float = 0.7,
) -> list[dict]:
    """
    Greedy MMR selection.

        MMR = λ·sim(query, doc) − (1−λ)·max sim(doc, already_selected)

    λ = 0.7 leans towards relevance while still breaking up near-duplicates.
    Candidates missing an 'embedding' key are embedded on the fly.
    """
    from .embedding_client import cosine_similarity, embed_texts

    if not candidates:
        return []

    missing = [i for i, item in enumerate(candidates) if "embedding" not in item]
    if missing:
        vectors = embed_texts([candidates[i]["content"] for i in missing])
        for position, vector in zip(missing, vectors):
            candidates[position]["embedding"] = vector

    selected: list[int] = []
    remaining = list(range(len(candidates)))

    while remaining and len(selected) < top_k:
        best_index, best_score = None, float("-inf")
        for index in remaining:
            relevance = cosine_similarity(query_embedding, candidates[index]["embedding"])
            redundancy = 0.0
            for chosen in selected:
                redundancy = max(
                    redundancy,
                    cosine_similarity(
                        candidates[index]["embedding"], candidates[chosen]["embedding"]
                    ),
                )
            mmr_score = lambda_param * relevance - (1 - lambda_param) * redundancy
            if mmr_score > best_score:
                best_score, best_index = mmr_score, index
        selected.append(best_index)
        remaining.remove(best_index)

    results = []
    for rank, index in enumerate(selected):
        item = dict(candidates[index])
        item.pop("embedding", None)     # keep the payload small for the LLM
        item["mmr_rank"] = rank + 1
        results.append(item)
    return results


# =============================================================================
# Cross-encoder (Jina Reranker v2, multilingual)
# =============================================================================

def rerank_cross_encoder(query: str, candidates: list[dict], top_k: int = 5) -> list[dict]:
    """
    Rerank with a cross-encoder that reads (query, document) jointly.

    Falls back to the incoming order if JINA_API_KEY is not configured, so the
    pipeline never breaks just because an optional key is missing.
    """
    api_key = os.getenv("JINA_API_KEY", "").strip()
    if not api_key or not candidates:
        if not api_key:
            print("⚠ JINA_API_KEY not set — keeping the existing order.")
        return sorted(candidates, key=lambda item: item.get("score", 0), reverse=True)[:top_k]

    import requests

    try:
        response = requests.post(
            "https://api.jina.ai/v1/rerank",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": JINA_MODEL,
                "query": query,
                "documents": [item["content"] for item in candidates],
                "top_n": top_k,
            },
            timeout=60,
        )
        response.raise_for_status()
        reranked = response.json()["results"]
    except Exception as error:
        print(f"⚠ Jina rerank failed ({error}) — keeping the existing order.")
        return sorted(candidates, key=lambda item: item.get("score", 0), reverse=True)[:top_k]

    output = []
    for entry in reranked[:top_k]:
        item = dict(candidates[entry["index"]])
        item["cross_encoder_score"] = entry["relevance_score"]
        item["score"] = entry["relevance_score"]
        output.append(item)
    return output


# =============================================================================
# Unified interface
# =============================================================================

def rerank(
    query: str,
    candidates: list,
    top_k: int = 5,
    method: str = DEFAULT_METHOD,
    query_embedding: Optional[list[float]] = None,
) -> list[dict]:
    """
    One entry point for all three strategies.

    `candidates` accepts either shape:
        - a flat list of results (one retriever)          -> treated as 1 ranked list
        - a list of ranked lists (hybrid: dense + sparse) -> fused
    """
    if not candidates:
        return []

    if method == "rrf":
        ranked_lists = candidates if _is_list_of_lists(candidates) else [candidates]
        return rerank_rrf(ranked_lists, top_k=top_k, k=RRF_K)

    flat = [item for group in candidates for item in group] if _is_list_of_lists(candidates) else candidates

    if method == "cross_encoder":
        return rerank_cross_encoder(query, flat, top_k)

    if method == "mmr":
        if query_embedding is None:
            from .embedding_client import embed_query

            query_embedding = embed_query(query)
        return rerank_mmr(query_embedding, flat, top_k=top_k)

    raise ValueError(f"Unknown rerank method: {method!r}")


# =============================================================================
# CLI
# =============================================================================

def _demo(query: str, method: str, top_k: int) -> None:
    from .task5_semantic_search import semantic_search
    from .task6_lexical_search import lexical_search

    dense = semantic_search(query, top_k=top_k * 2)
    sparse = lexical_search(query, top_k=top_k * 2)

    print(f"\nQuery: {query}")
    print(f"  dense hits : {len(dense)}  (top cosine {dense[0]['score'] if dense else 0:.4f})")
    print(f"  sparse hits: {len(sparse)} (top bm25   {sparse[0]['score'] if sparse else 0:.4f})")

    if method == "rrf":
        fused = rerank_rrf([dense, sparse], top_k=top_k)
    else:
        fused = rerank(query, dense + sparse, top_k=top_k, method=method)

    print(f"\n--- {method.upper()} top-{top_k} ---")
    for i, item in enumerate(fused, 1):
        meta = item.get("metadata", {})
        detail = item.get("retriever_scores", {})
        print(f"  {i}. score={item['score']:.6f} {detail}")
        print(f"     {meta.get('source', '?')} | {meta.get('section', '')}")
        print(f"     {item['content'][:140].replace(chr(10), ' ')}...")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reranking demo")
    parser.add_argument("-q", "--query", default="tuition fee payment methods")
    parser.add_argument("-k", "--top-k", type=int, default=5)
    parser.add_argument(
        "--method", choices=["rrf", "mmr", "cross_encoder"], default=DEFAULT_METHOD
    )
    args = parser.parse_args()
    _demo(args.query, args.method, args.top_k)
