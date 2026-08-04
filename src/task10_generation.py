"""
Task 10 — Generation Có Citation.

Hướng dẫn:
    1. Chọn top_k, top_p phù hợp (giải thích lý do)
    2. Sắp xếp lại chunks sau reranking để tránh "lost in the middle"
    3. Inject context vào prompt
    4. Yêu cầu LLM trả lời có citation
    5. Nếu không đủ evidence → "I cannot verify this information"

Gợi ý LLM: OpenRouter có nhiều model gắn hậu tố ":free" không tính phí — xem
https://openrouter.ai/models?max_price=0 — phù hợp nếu chưa có credit trả phí.
Base URL: "https://openrouter.ai/api/v1", dùng chung interface với OpenAI SDK.
"""

import os
from dotenv import load_dotenv

load_dotenv()

from .task9_retrieval_pipeline import retrieve


# =============================================================================
# CONFIGURATION — Giải thích lựa chọn
# =============================================================================

# top_k: Số chunks đưa vào context
# Chọn 5 vì: đủ evidence mà không quá dài gây lost in the middle
TOP_K = 5

# top_p (nucleus sampling): Xác suất tích luỹ cho token generation
# Chọn 0.9 vì: đủ diverse nhưng không quá random
TOP_P = 0.9

# temperature: Độ ngẫu nhiên của output
# Chọn 0.3 vì: RAG cần factual, ít sáng tạo
TEMPERATURE = 0.3

# Read the answer model from .env instead of coupling generation to embeddings.
# The default is an OpenAI model id because this workspace uses OPENAI_API_KEY.
LLM_MODEL = os.getenv('LLM_MODEL', '').strip() or 'gpt-4o-mini'
OPENROUTER_BASE_URL = os.getenv(
    'OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'
).rstrip('/')
NO_EVIDENCE_ANSWER = 'Tôi không thể xác minh thông tin này từ nguồn hiện có.'
LLM_UNAVAILABLE_ANSWER = 'Không thể tạo câu trả lời lúc này do dịch vụ LLM không khả dụng.'


# =============================================================================
# SYSTEM PROMPT
# =============================================================================

SYSTEM_PROMPT = """Bạn là trợ lý trả lời câu hỏi về dịch vụ và chính sách đại học
(học phí, học bổng, ký túc xá, thư viện, đăng ký học phần).

Quy tắc bắt buộc:
1. Chỉ sử dụng thông tin từ context được cung cấp — KHÔNG bịa đặt
2. Mỗi khẳng định phải có trích dẫn số ngay sau, ví dụ: [1] hoặc [2]
   Số trích dẫn phải khớp chính xác với số thứ tự nguồn trong context
3. Nếu context không đủ thông tin → trả lời: "Tôi không thể xác minh thông tin này từ nguồn hiện có"
4. Trả lời bằng tiếng Việt, có cấu trúc rõ ràng theo đoạn văn
5. Không suy luận hay mở rộng ngoài những gì được nêu trong context"""


# =============================================================================
# DOCUMENT REORDERING (tránh lost in the middle)
# =============================================================================

def reorder_for_llm(chunks: list[dict]) -> list[dict]:
    """
    Sắp xếp chunks để tránh "lost in the middle" effect.

    LLM nhớ tốt thông tin ở ĐẦU và CUỐI prompt, quên thông tin ở GIỮA.
    Strategy: đặt chunks quan trọng nhất ở đầu và cuối, kém quan trọng ở giữa.

    Input order (by score):  [1, 2, 3, 4, 5]
    Output order:            [1, 3, 5, 4, 2]
    (best first, worst in middle, second-best last)

    Args:
        chunks: List sorted by score descending (from retrieval)

    Returns:
        List reordered để maximize LLM attention.
    """
    # Reference outline for the implemented strategy:
    #
    # if len(chunks) <= 2:
    #     return chunks
    #
    # front = chunks[::2]   # index 0, 2, 4 -> đặt ở đầu
    # back = chunks[1::2]   # index 1, 3    -> đặt ở cuối (reversed)
    # return front + back[::-1]
    if len(chunks) <= 2:
        return list(chunks)

    front = chunks[::2]
    back = chunks[1::2]
    return front + back[::-1]


# =============================================================================
# CONTEXT FORMATTING
# =============================================================================

def format_context(chunks: list[dict]) -> str:
    """
    Format chunks thành context string cho prompt.
    Mỗi chunk có label source để LLM có thể cite.

    Args:
        chunks: List of {'content': str, 'metadata': dict, 'score': float}

    Returns:
        Formatted context string.
    """
    # Reference outline for the implemented formatter:
    #
    # context_parts = []
    # for i, chunk in enumerate(chunks, 1):
    #     source = chunk.get("metadata", {}).get("source", f"Source {i}")
    #     doc_type = chunk.get("metadata", {}).get("type", "unknown")
    #     context_parts.append(
    #         f"[Document {i} | Source: {source} | Type: {doc_type}]\n"
    #         f"{chunk['content']}\n"
    #     )
    # return "\n---\n".join(context_parts)
    context_parts = []
    for index, chunk in enumerate(chunks, start=1):
        metadata = chunk.get('metadata') or {}
        source = metadata.get('source') or f'Source {index}'
        doc_type = metadata.get('type') or 'unknown'
        section = metadata.get('section') or metadata.get('heading') or ''
        label = f'[{index}] Source: {source} | Type: {doc_type}'
        if section:
            label += f' | Section: {section}'
        context_parts.append(f'{label}\n{chunk.get("content", "").strip()}')

    return '\n\n---\n\n'.join(context_parts)


# =============================================================================
# GENERATION
# =============================================================================

def _llm_client_and_model():
    '''Prefer OpenAI for answers; use OpenRouter only as a generation fallback.'''
    from openai import OpenAI

    openrouter_key = os.getenv('OPENROUTER_API_KEY', '').strip()
    openai_key = os.getenv('OPENAI_API_KEY', '').strip()

    if openai_key and not openai_key.startswith('sk-proj-...'):
        model = LLM_MODEL.removeprefix('openai/')
        return OpenAI(api_key=openai_key), model

    if openrouter_key and not openrouter_key.startswith('sk-or-v1-...'):
        model = LLM_MODEL
        if '/' not in model:
            model = f'openai/{model}'
        return OpenAI(api_key=openrouter_key, base_url=OPENROUTER_BASE_URL), model

    raise RuntimeError('Configure OPENAI_API_KEY or OPENROUTER_API_KEY in .env')


def generate_with_citation(
    query: str,
    top_k: int = TOP_K,
    use_reranking: bool = True,
) -> dict:
    """
    End-to-end RAG generation có citation.

    Pipeline:
        1. Retrieve relevant chunks
        2. Reorder để tránh lost in the middle
        3. Format context với source labels
        4. Build prompt (system + context + query)
        5. Call LLM
        6. Return answer + sources

    Args:
        query: Câu hỏi của user
        top_k: Số chunks tối đa dùng làm evidence
        use_reranking: Có chạy bước reranking trong Task 9 hay không

    Returns:
        {
            'answer': str,           # Câu trả lời có citation
            'sources': list[dict],   # Các chunks đã dùng
            'retrieval_source': str  # 'hybrid' hoặc 'pageindex'
        }
    """
    # Reference outline for the implemented generation pipeline:
    #
    # # Step 1: Retrieve
    # chunks = retrieve(query, top_k=top_k)
    #
    # # Step 2: Reorder
    # reordered = reorder_for_llm(chunks)
    #
    # # Step 3: Format context
    # context = format_context(reordered)
    #
    # # Step 4: Build prompt
    # user_message = f"""Context:\n{context}\n\n---\n\nQuestion: {query}"""
    #
    # # Step 5: Call LLM (OpenRouter — OpenAI-compatible API)
    # from openai import OpenAI
    # api_key = os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY")
    # client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")
    #
    # response = client.chat.completions.create(
    #     model=LLM_MODEL,
    #     messages=[
    #         {"role": "system", "content": SYSTEM_PROMPT},
    #         {"role": "user", "content": user_message}
    #     ],
    #     temperature=TEMPERATURE,
    #     top_p=TOP_P,
    # )
    #
    # answer = response.choices[0].message.content
    #
    # # Step 6: Return
    # return {
    #     "answer": answer,
    #     "sources": chunks,
    #     "retrieval_source": chunks[0].get("source", "hybrid") if chunks else "none"
    # }
    if not isinstance(query, str) or not query.strip():
        return {
            'answer': NO_EVIDENCE_ANSWER,
            'sources': [],
            'retrieval_source': 'none',
        }

    query = query.strip()
    chunks = retrieve(query, top_k=top_k, use_reranking=use_reranking)
    retrieval_source = chunks[0].get('source', 'hybrid') if chunks else 'none'

    if not chunks:
        return {
            'answer': NO_EVIDENCE_ANSWER,
            'sources': [],
            'retrieval_source': retrieval_source,
        }

    reordered = reorder_for_llm(chunks)
    context = format_context(reordered)
    user_message = (
        f'Context:\n{context}\n\n---\n\nQuestion: {query}\n\n'
        'Answer only from the context. Cite every factual claim with the '
        'matching numeric source marker such as [1] or [2].'
    )

    try:
        client, model = _llm_client_and_model()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': user_message},
            ],
            temperature=TEMPERATURE,
            top_p=TOP_P,
        )
        answer = (response.choices[0].message.content or '').strip()
        if not answer:
            answer = NO_EVIDENCE_ANSWER
    except Exception as error:
        print(f'  WARNING: LLM generation unavailable ({type(error).__name__})')
        answer = LLM_UNAVAILABLE_ANSWER

    return {
        'answer': answer,
        # Keep source order identical to the numbered context so frontend
        # citation [n] opens sources[n - 1].
        'sources': reordered,
        'retrieval_source': retrieval_source,
    }


if __name__ == "__main__":
    test_queries = [
        "Học phí tại RMIT Vietnam là bao nhiêu?",
        "Làm sao để đặt phòng học nhóm ở thư viện?",
        "Sinh viên quốc tế có những học bổng nào?",
    ]

    for q in test_queries:
        print(f"\n{'='*70}")
        print(f"Q: {q}")
        print("=" * 70)
        result = generate_with_citation(q)
        print(f"\nA: {result['answer']}")
        print(f"\n[Sources: {len(result['sources'])} chunks | via {result['retrieval_source']}]")
