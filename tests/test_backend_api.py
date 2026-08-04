import asyncio

import httpx

from backend.main import create_app
from backend.schemas import SourceDocument
from backend.services.rag import RagService


def _request(app, method: str, url: str, **kwargs) -> httpx.Response:
    async def send() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.request(method, url, **kwargs)

    return asyncio.run(send())


def _fake_generator(query: str, top_k: int) -> dict:
    return {
        "answer": f"Answer for: {query}",
        "retrieval_source": "hybrid",
        "sources": [
            {
                "content": "Scholarship evidence",
                "score": 0.91,
                "metadata": {
                    "source": "scholarship-terms-2026.md",
                    "type": "legal",
                    "url": "https://example.test/scholarship",
                    "chunk_index": 2,
                },
            }
        ][:top_k],
    }


def test_health_check() -> None:
    app = create_app(rag_service=RagService(generator=_fake_generator))

    response = _request(app, "GET", "/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["components"]["api"]["status"] == "ready"


def test_chat_response_matches_frontend_contract() -> None:
    app = create_app(rag_service=RagService(generator=_fake_generator))

    response = _request(
        app,
        "POST",
        "/api/chat",
        json={
            "message": "Điều kiện học bổng?",
            "conversation_id": "conversation-1",
            "top_k": 5,
            "use_reranking": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Answer for: Điều kiện học bổng?"
    assert body["sources"][0]["category"] == "LEGAL"
    assert body["sources"][0]["method"] == "Hybrid"
    assert body["sources"][0]["year"] == 2026
    assert body["trace"]["mode"] == "hybrid"


def test_chat_rejects_blank_message() -> None:
    app = create_app(rag_service=RagService(generator=_fake_generator))

    response = _request(app, "POST", "/api/chat", json={"message": "   "})

    assert response.status_code == 422


def test_chat_returns_503_when_pipeline_is_not_implemented() -> None:
    def unavailable_generator(query: str, top_k: int) -> dict:
        raise NotImplementedError

    app = create_app(rag_service=RagService(generator=unavailable_generator))

    response = _request(app, "POST", "/api/chat", json={"message": "Hello"})

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "rag_pipeline_not_ready"


def test_documents_returns_frontend_knowledge_base_contract() -> None:
    service = RagService(generator=_fake_generator)
    service.list_documents = lambda: [  # type: ignore[method-assign]
        SourceDocument(
            id='fees-guide',
            title='Student fees guide',
            category='LEGAL',
            score=1.0,
            method='Hybrid',
            excerpt='Fee payment evidence',
            content='Fee payment evidence',
            year=2026,
            verified=True,
            chunks=12,
            indexedAt='',
        )
    ]
    app = create_app(rag_service=service)

    response = _request(app, 'GET', '/api/documents')

    assert response.status_code == 200
    assert response.json()[0]['id'] == 'fees-guide'
    assert response.json()[0]['chunks'] == 12
