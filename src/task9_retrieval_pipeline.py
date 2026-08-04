"""
Task 9 — Retrieval Pipeline Hoàn Chỉnh.

Kết hợp semantic search + lexical search + reranking + PageIndex fallback
thành một pipeline thống nhất.

Logic:
    1. Chạy semantic_search + lexical_search song song
    2. Merge kết quả (RRF hoặc weighted fusion)
    3. Rerank
    4. Nếu top result score < threshold → fallback sang PageIndex
    5. Return top_k results

⚠️ BẪY THƯỜNG GẶP — đọc kỹ trước khi code:
    Nếu bạn dùng điểm RRF đã fuse (Task 7) để so với score_threshold, bạn sẽ gặp bug
    thật: RRF max score luôn ≈ 1/(k+1) ≈ 0.0164 (k=60) BẤT KỂ nội dung có liên quan
    hay không. Nếu đặt threshold thấp (như 0.005) để "hợp" với thang điểm RRF, thực
    chất KHÔNG câu hỏi nào đủ thấp để trigger fallback nữa — kể cả query hoàn toàn vô
    nghĩa vẫn trả về kết quả "hybrid" (rác) thay vì fallback đúng như thiết kế.

    Cách sửa đúng: giữ điểm cosine similarity GỐC của semantic_search (trước khi qua
    RRF) làm căn cứ quyết định fallback, tách biệt khỏi điểm RRF dùng để sắp xếp kết
    quả cuối cùng. Calibrate threshold bằng cách tự đo: chạy vài câu hỏi chắc chắn
    liên quan và vài câu chắc chắn lạc đề/rác qua semantic_search, xem khoảng cách
    điểm số giữa hai nhóm rồi chọn ngưỡng nằm giữa.
"""

from concurrent.futures import ThreadPoolExecutor

from .task5_semantic_search import semantic_search
from .task6_lexical_search import lexical_search
from .task7_reranking import rerank, rerank_rrf
from .task8_pageindex_vectorless import pageindex_search


# =============================================================================
# CONFIGURATION
# =============================================================================

# TODO: Calibrate threshold này bằng cách tự đo điểm cosine của semantic_search
# cho câu hỏi liên quan vs câu hỏi lạc đề (xem ghi chú ở trên) — ĐỪNG copy nguyên
# giá trị mẫu, mỗi corpus/embedding model sẽ cho khoảng điểm khác nhau.
# Calibrated on this RMIT corpus: min in-domain=0.6056, max out-domain=0.4158.
SCORE_THRESHOLD = 0.511  # midpoint separates answerable and unrelated probes
DEFAULT_TOP_K = 5
RERANK_METHOD = "rrf"  # "cross_encoder" | "mmr" | "rrf"


def _run_hybrid_searches(query: str, candidate_count: int) -> tuple[list[dict], list[dict]]:
    '''Run dense and lexical retrieval concurrently and isolate branch errors.'''
    with ThreadPoolExecutor(max_workers=2) as executor:
        dense_future = executor.submit(semantic_search, query, top_k=candidate_count)
        sparse_future = executor.submit(lexical_search, query, top_k=candidate_count)

        try:
            dense_results = dense_future.result() or []
        except Exception as error:
            print(f'  WARNING: Semantic search unavailable ({error})')
            dense_results = []

        try:
            sparse_results = sparse_future.result() or []
        except Exception as error:
            print(f'  WARNING: Lexical search unavailable ({error})')
            sparse_results = []

    return dense_results, sparse_results


def _normalize_results(results: list[dict], source: str, top_k: int) -> list[dict]:
    '''Return the stable payload shape consumed by Task 10.'''
    normalized = []
    for item in results[:top_k]:
        result = dict(item)
        result.setdefault('metadata', {})
        result['score'] = float(result.get('score', 0.0))
        result['source'] = source
        normalized.append(result)
    return normalized


def retrieve(
    query: str,
    top_k: int = DEFAULT_TOP_K,
    score_threshold: float = SCORE_THRESHOLD,
    use_reranking: bool = True,
) -> list[dict]:
    """
    Retrieval pipeline hoàn chỉnh với fallback logic.

    Pipeline:
        Query
          ├→ Semantic Search → dense_results (giữ điểm cosine gốc)
          ├→ Lexical Search  → sparse_results
          │
          ├→ Merge (RRF) → merged_results
          ├→ Rerank → reranked_results
          │
          └→ If dense_results[0]["score"] < threshold:
                └→ PageIndex Vectorless → fallback_results

    Args:
        query: Câu truy vấn
        top_k: Số lượng kết quả cuối cùng
        score_threshold: Ngưỡng điểm cosine gốc tối thiểu (KHÔNG phải điểm RRF)
        use_reranking: Có áp dụng reranking hay không

    Returns:
        List of {
            'content': str,
            'score': float,
            'metadata': dict,
            'source': str  # 'hybrid' hoặc 'pageindex'
        }
    """
    # Reference implementation outline:
    #
    # Step 1: Song song chạy semantic + lexical
    # dense_results = semantic_search(query, top_k=top_k * 2)
    # sparse_results = lexical_search(query, top_k=top_k * 2)
    #
    # Step 2: Merge bằng RRF
    # merged = rerank_rrf([dense_results, sparse_results], top_k=top_k * 2)
    # for item in merged:
    #     item["source"] = "hybrid"
    #
    # Step 3: Rerank
    # if use_reranking and merged:
    #     final_results = rerank(query, merged, top_k=top_k, method=RERANK_METHOD)
    # else:
    #     final_results = merged[:top_k]
    #
    # Step 4: Check threshold DÙNG ĐIỂM COSINE GỐC (dense_results), KHÔNG PHẢI RRF
    # best_score = dense_results[0]["score"] if dense_results else 0.0
    # if best_score < score_threshold:
    #     print(f"  ⚠ Semantic best score ({best_score:.3f}) < threshold ({score_threshold})")
    #     fallback = pageindex_search(query, top_k=top_k)
    #     if fallback:
    #         return fallback
    #
    # return final_results[:top_k]

    if not isinstance(query, str) or not query.strip() or top_k <= 0:
        return []

    query = query.strip()
    candidate_count = top_k * 2
    dense_results, sparse_results = _run_hybrid_searches(query, candidate_count)

    # RRF fuses ranks without comparing incompatible cosine and BM25 scales.
    merged = rerank_rrf(
        [dense_results, sparse_results],
        top_k=candidate_count,
    )
    for item in merged:
        item['source'] = 'hybrid'

    # Run the configured optional second-stage reranker over fused candidates.
    if use_reranking and merged:
        final_results = rerank(
            query,
            merged,
            top_k=top_k,
            method=RERANK_METHOD,
        )
    else:
        final_results = merged[:top_k]

    # Fallback confidence must use raw dense cosine, never the tiny RRF score.
    best_dense_score = max(
        (float(item.get('score', 0.0)) for item in dense_results),
        default=0.0,
    )
    if best_dense_score < score_threshold:
        try:
            fallback_results = pageindex_search(query, top_k=top_k)
        except Exception as error:
            print(f'  WARNING: PageIndex fallback unavailable ({error})')
            fallback_results = []

        if fallback_results:
            return _normalize_results(fallback_results, 'pageindex', top_k)

    return _normalize_results(final_results, 'hybrid', top_k)


if __name__ == "__main__":
    test_queries = [
        "What is the tuition fee at RMIT Vietnam?",
        "How do I book a library study room?",
        "What scholarships are available for international students?",
        "xyzabc123nonsense",  # Query không có kết quả → test fallback
    ]

    for q in test_queries:
        print(f"\nQuery: {q}")
        print("-" * 60)
        results = retrieve(q, top_k=3)
        for i, r in enumerate(results, 1):
            print(f"  {i}. [{r['score']:.3f}] [{r['source']}] {r['content'][:80]}...")
