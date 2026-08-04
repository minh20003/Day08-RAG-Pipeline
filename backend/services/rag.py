"""Adapter between the HTTP API and the Task 10 RAG pipeline."""

from __future__ import annotations

import hashlib
import inspect
import re
from collections.abc import Callable
from pathlib import Path
from time import perf_counter
from typing import Any

from backend.schemas import (
    ChatRequest,
    RagResponse,
    RetrievalTrace,
    SourceDocument,
)


Generator = Callable[..., dict[str, Any]]


class RagPipelineNotReady(RuntimeError):
    """Raised when retrieval or generation has not been configured yet."""


class RagService:
    """Call Task 10 and normalize its output to the frontend API contract."""

    def __init__(self, generator: Generator | None = None) -> None:
        self._generator = generator

    @staticmethod
    def _load_generator() -> Generator:
        # Imported lazily so health checks can run before heavy AI dependencies load.
        from src.task10_generation import generate_with_citation

        return generate_with_citation

    def answer(self, request: ChatRequest) -> RagResponse:
        started_at = perf_counter()
        generator = self._generator or self._load_generator()

        try:
            kwargs: dict[str, Any] = {"top_k": request.top_k}
            if "use_reranking" in inspect.signature(generator).parameters:
                kwargs["use_reranking"] = request.use_reranking
            result = generator(request.message, **kwargs)
        except NotImplementedError as exc:
            raise RagPipelineNotReady(
                "RAG pipeline is not implemented yet. Complete Task 4-10 first."
            ) from exc

        if not isinstance(result, dict) or not str(result.get("answer", "")).strip():
            raise RuntimeError("Task 10 returned an invalid response")

        raw_sources = result.get("sources") or []
        if not isinstance(raw_sources, list):
            raise RuntimeError("Task 10 returned an invalid sources list")

        default_source = str(result.get("retrieval_source", "hybrid"))
        sources = [
            self._normalize_source(source, default_source, index)
            for index, source in enumerate(raw_sources)
            if isinstance(source, dict)
        ]
        mode = self._trace_mode(default_source, sources)

        raw_trace = result.get("trace") if isinstance(result.get("trace"), dict) else {}
        steps = raw_trace.get("steps")
        if not isinstance(steps, list) or not all(isinstance(step, str) for step in steps):
            steps = self._default_steps(mode, request.use_reranking)

        return RagResponse(
            answer=str(result["answer"]).strip(),
            sources=sources,
            trace=RetrievalTrace(
                steps=steps,
                latency=f"{perf_counter() - started_at:.2f}s",
                mode=mode,
            ),
        )

    def list_documents(self) -> list[SourceDocument]:
        '''Read the indexed corpus from ChromaDB and aggregate chunks by source.'''
        try:
            from src.task4_chunking_indexing import get_collection

            payload = get_collection(create=False).get(
                include=['documents', 'metadatas'],
            )
        except Exception:
            return []

        documents = payload.get('documents') or []
        metadatas = payload.get('metadatas') or []
        grouped: dict[str, dict[str, Any]] = {}

        for index, (content, raw_metadata) in enumerate(zip(documents, metadatas)):
            metadata = dict(raw_metadata or {})
            source_name = str(metadata.get('source') or f'Document {index + 1}')
            entry = grouped.get(source_name)
            if entry is None:
                metadata['chunks'] = 0
                entry = {
                    'content': str(content or ''),
                    'metadata': metadata,
                    'score': 1.0,
                    'source': 'hybrid',
                }
                grouped[source_name] = entry
            entry['metadata']['chunks'] += 1

        ordered = sorted(
            grouped.values(),
            key=lambda item: str(item['metadata'].get('title') or item['metadata'].get('source')),
        )
        return [
            self._normalize_source(item, 'hybrid', index)
            for index, item in enumerate(ordered)
        ]

    @staticmethod
    def _normalize_source(
        raw: dict[str, Any],
        default_source: str,
        index: int,
    ) -> SourceDocument:
        metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        content = str(raw.get("content") or raw.get("document") or "").strip()
        source_name = str(
            metadata.get("source")
            or raw.get("title")
            or raw.get("id")
            or f"Document {index + 1}"
        )
        title = str(metadata.get("title") or Path(source_name).stem).replace("_", " ").strip()
        category = RagService._category(metadata, source_name)
        method = RagService._method(str(raw.get("source") or default_source))
        source_id = str(metadata.get("id") or raw.get("id") or "").strip()
        if not source_id:
            identity = f"{source_name}:{metadata.get('chunk_index', index)}:{content}"
            source_id = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:16]

        url_value = metadata.get("url") or metadata.get("source_url") or raw.get("url")
        url = str(url_value).strip() if url_value else None
        excerpt = " ".join(content.split())[:320]

        return SourceDocument(
            id=source_id,
            title=title or f"Document {index + 1}",
            category=category,
            score=RagService._float_or_default(raw.get("score"), 0.0),
            method=method,
            excerpt=excerpt,
            content=content,
            year=RagService._year(metadata, source_name),
            url=url,
            verified=bool(metadata.get("verified", bool(source_name or url))),
            chunks=RagService._positive_int(metadata.get("chunks"), 1),
            indexedAt=str(metadata.get("indexedAt") or metadata.get("indexed_at") or ""),
        )

    @staticmethod
    def _category(metadata: dict[str, Any], source_name: str) -> str:
        value = str(metadata.get("category") or metadata.get("type") or "").lower()
        haystack = f"{value} {source_name.lower()}"
        return "LEGAL" if "legal" in haystack else "NEWS"

    @staticmethod
    def _method(value: str) -> str:
        normalized = value.lower()
        if "pageindex" in normalized:
            return "PageIndex"
        if "semantic" in normalized:
            return "Semantic"
        if "bm25" in normalized or "lexical" in normalized:
            return "BM25"
        return "Hybrid"

    @staticmethod
    def _year(metadata: dict[str, Any], source_name: str) -> int:
        raw_year = metadata.get("year")
        try:
            year = int(raw_year)
            if 1900 <= year <= 2200:
                return year
        except (TypeError, ValueError):
            pass

        match = re.search(r"(?:19|20)\d{2}", source_name)
        return int(match.group()) if match else 0

    @staticmethod
    def _float_or_default(value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _positive_int(value: Any, default: int) -> int:
        try:
            parsed = int(value)
            return parsed if parsed > 0 else default
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _trace_mode(default_source: str, sources: list[SourceDocument]) -> str:
        if "pageindex" in default_source.lower() or any(
            source.method == "PageIndex" for source in sources
        ):
            return "pageindex"
        return "hybrid" if sources else "none"

    @staticmethod
    def _default_steps(mode: str, use_reranking: bool) -> list[str]:
        if mode == "pageindex":
            return ["Semantic score below threshold", "PageIndex", "LLM generation"]
        if mode == "none":
            return ["Retrieval", "Insufficient evidence"]

        steps = ["Semantic", "BM25"]
        if use_reranking:
            steps.append("Reranking")
        steps.append("LLM generation")
        return steps

