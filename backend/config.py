"""Environment-based configuration for the API service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")


def _resolve_project_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def _allowed_origins() -> tuple[str, ...]:
    configured = os.getenv(
        "BACKEND_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return tuple(origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str
    app_version: str
    allowed_origins: tuple[str, ...]
    chroma_db_path: Path
    chroma_collection: str


@lru_cache
def get_settings() -> Settings:
    """Load settings once per process."""
    return Settings(
        app_name=os.getenv("BACKEND_APP_NAME", "University Services RAG API"),
        app_version=os.getenv("BACKEND_APP_VERSION", "0.1.0"),
        allowed_origins=_allowed_origins(),
        chroma_db_path=_resolve_project_path(os.getenv("CHROMA_DB_PATH", "chroma_db")),
        chroma_collection=os.getenv(
            "CHROMA_COLLECTION_NAME",
            "university_services_docs",
        ),
    )

