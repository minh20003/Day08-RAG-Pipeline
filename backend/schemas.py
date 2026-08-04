"""HTTP request and response schemas shared by the API routes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=4_000)
    conversation_id: str | None = Field(default=None, max_length=128)
    top_k: int = Field(default=5, ge=1, le=20)
    use_reranking: bool = True

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value


class SourceDocument(BaseModel):
    id: str
    title: str
    category: Literal["LEGAL", "NEWS"]
    score: float
    method: Literal["Hybrid", "Semantic", "BM25", "PageIndex"]
    excerpt: str
    content: str
    year: int
    url: str | None = None
    verified: bool
    chunks: int
    indexedAt: str


class RetrievalTrace(BaseModel):
    steps: list[str]
    latency: str
    mode: Literal["hybrid", "pageindex", "none"]


class RagResponse(BaseModel):
    answer: str
    sources: list[SourceDocument]
    trace: RetrievalTrace


class ComponentStatus(BaseModel):
    status: Literal["ready", "waiting"]
    detail: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    components: dict[str, ComponentStatus]

