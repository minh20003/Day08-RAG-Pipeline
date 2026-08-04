"""FastAPI application entry point."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from backend.config import PROJECT_ROOT, Settings, get_settings
from backend.schemas import (
    ChatRequest,
    ComponentStatus,
    HealthResponse,
    RagResponse,
    SourceDocument,
)
from backend.services.rag import RagPipelineNotReady, RagService


logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    rag_service: RagService | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()
    service = rag_service or RagService()
    frontend_dist = PROJECT_ROOT / "frontend" / "dist"
    frontend_index = frontend_dist / "index.html"

    application = FastAPI(
        title=app_settings.app_name,
        version=app_settings.app_version,
        description="HTTP adapter for the University Services RAG pipeline.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @application.get("/", include_in_schema=False)
    async def root():
        if frontend_index.is_file():
            return FileResponse(frontend_index)
        return {"service": app_settings.app_name, "docs": "/docs", "health": "/health"}

    @application.get("/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        chroma_ready = app_settings.chroma_db_path.is_dir() and any(
            app_settings.chroma_db_path.iterdir()
        )
        llm_ready = bool(os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY"))
        pageindex_hosted = bool(os.getenv('PAGEINDEX_API_KEY'))
        return HealthResponse(
            status="ok",
            service=app_settings.app_name,
            version=app_settings.app_version,
            components={
                "api": ComponentStatus(status="ready", detail="FastAPI is accepting requests"),
                "chroma": ComponentStatus(
                    status="ready" if chroma_ready else "waiting",
                    detail=(
                        f"Collection: {app_settings.chroma_collection}"
                        if chroma_ready
                        else "Waiting for a persisted ChromaDB index"
                    ),
                ),
                "llm": ComponentStatus(
                    status="ready" if llm_ready else "waiting",
                    detail="API key configured" if llm_ready else "Waiting for an LLM API key",
                ),
                'pageindex': ComponentStatus(
                    status='ready',
                    detail=(
                        'Hosted PageIndex API configured'
                        if pageindex_hosted
                        else 'Local structural fallback ready'
                    ),
                ),
            },
        )

    @application.post(
        "/api/chat",
        response_model=RagResponse,
        status_code=status.HTTP_200_OK,
        tags=["rag"],
        responses={
            status.HTTP_503_SERVICE_UNAVAILABLE: {
                "description": "The retrieval/generation pipeline is not ready"
            }
        },
    )
    async def chat(request: ChatRequest) -> RagResponse:
        try:
            return await run_in_threadpool(service.answer, request)
        except RagPipelineNotReady as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "rag_pipeline_not_ready", "message": str(exc)},
            ) from exc
        except Exception as exc:
            logger.exception("RAG request failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={
                    "code": "rag_pipeline_error",
                    "message": "The RAG pipeline could not process this request.",
                },
            ) from exc

    @application.get(
        '/api/documents',
        response_model=list[SourceDocument],
        tags=['rag'],
    )
    async def documents() -> list[SourceDocument]:
        '''Expose the real ChromaDB corpus to the frontend knowledge-base view.'''
        return await run_in_threadpool(service.list_documents)

    assets_dir = frontend_dist / "assets"
    if assets_dir.is_dir():
        application.mount(
            "/assets",
            StaticFiles(directory=assets_dir),
            name="frontend-assets",
        )

    return application


app = create_app()
