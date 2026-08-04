"""
Shared embedding client — OpenRouter `baai/bge-m3`.

Owned by Role 3 (Vector DB & Dense Search). Used by Task 4 (indexing),
Task 5 (query embedding) and Task 7 (MMR embeddings) so that every part of the
pipeline embeds text with the exact same model and the exact same normalisation.
Mixing embedding models between index time and query time silently destroys
retrieval quality, so there is deliberately only ONE place that produces vectors.

Why OpenRouter instead of local sentence-transformers:
    - `BAAI/bge-m3` weights are ~2.2 GB; a hosted call keeps the repo and the
      lab machines light and makes results identical for every team member.
    - OpenRouter exposes an OpenAI-compatible `/embeddings` endpoint, so the
      same API key already used for generation (Task 10) also covers embeddings.

Why bge-m3:
    - 1024-dim, multilingual (Vietnamese + English in the same vector space),
      8192-token context — our corpus mixes English RMIT policy PDFs with
      Vietnamese questions from the chatbot UI.
    - It is a *symmetric* retrieval model: unlike bge-v1.5, it needs NO
      "Represent this sentence for searching..." instruction prefix. Queries and
      passages are embedded exactly the same way.

Cost control:
    Every vector is cached on disk (SQLite, keyed by sha256 of model+text), so
    re-running `task4_chunking_indexing` or re-asking the same question costs
    zero API calls. Delete `.cache/embeddings.sqlite3` to force a refresh.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Iterable, Sequence

import requests
from dotenv import load_dotenv

load_dotenv()

# =============================================================================
# CONFIGURATION
# =============================================================================

OPENROUTER_BASE_URL = os.getenv(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
).rstrip("/")
EMBEDDINGS_ENDPOINT = f"{OPENROUTER_BASE_URL}/embeddings"

# OpenRouter model id (lowercase) for BAAI/bge-m3.
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "baai/bge-m3")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1024"))

# bge-m3 accepts 8192 tokens; our chunks are ~800 chars so batching is safe.
BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))
REQUEST_TIMEOUT = int(os.getenv("EMBEDDING_TIMEOUT", "120"))
MAX_RETRIES = 5

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / ".cache"
CACHE_PATH = CACHE_DIR / "embeddings.sqlite3"


class EmbeddingError(RuntimeError):
    """Raised when embeddings cannot be produced (missing key, API failure)."""


# =============================================================================
# DISK CACHE (SQLite — no extra dependency, safe across processes)
# =============================================================================

_cache_state = threading.local()


def _get_cache() -> sqlite3.Connection:
    connection = getattr(_cache_state, 'connection', None)
    if connection is None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(CACHE_PATH), timeout=30)
        connection.execute(
            "CREATE TABLE IF NOT EXISTS embeddings ("
            "  key TEXT PRIMARY KEY,"
            "  vector TEXT NOT NULL"
            ")"
        )
        connection.commit()
        _cache_state.connection = connection
    return connection


def _cache_key(text: str, model: str) -> str:
    digest = hashlib.sha256(f"{model}\x00{text}".encode("utf-8")).hexdigest()
    return digest


def _cache_get_many(keys: Sequence[str]) -> dict[str, list[float]]:
    if not keys:
        return {}
    cache = _get_cache()
    found: dict[str, list[float]] = {}
    # SQLite has a variable limit (~999); chunk the IN clause.
    for start in range(0, len(keys), 500):
        window = keys[start : start + 500]
        placeholders = ",".join("?" * len(window))
        rows = cache.execute(
            f"SELECT key, vector FROM embeddings WHERE key IN ({placeholders})",
            window,
        ).fetchall()
        for key, blob in rows:
            found[key] = json.loads(blob)
    return found


def _cache_put_many(items: Iterable[tuple[str, list[float]]]) -> None:
    cache = _get_cache()
    cache.executemany(
        "INSERT OR REPLACE INTO embeddings (key, vector) VALUES (?, ?)",
        [(key, json.dumps(vector)) for key, vector in items],
    )
    cache.commit()


def cache_stats() -> dict:
    """Small helper used by the CLI banners / docs."""
    cache = _get_cache()
    (count,) = cache.execute("SELECT COUNT(*) FROM embeddings").fetchone()
    size_bytes = CACHE_PATH.stat().st_size if CACHE_PATH.exists() else 0
    return {"cached_vectors": count, "cache_mb": round(size_bytes / 1_048_576, 2)}


# =============================================================================
# API CALL
# =============================================================================

def get_api_key() -> str:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key or key.startswith("sk-or-v1-..."):
        raise EmbeddingError(
            "OPENROUTER_API_KEY is missing. Copy .env.example to .env and paste "
            "your key (https://openrouter.ai/keys)."
        )
    return key


def _post_embeddings(texts: Sequence[str]) -> list[list[float]]:
    """One HTTP call with retry/backoff on 429 and 5xx."""
    headers = {
        "Authorization": f"Bearer {get_api_key()}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": list(texts),
        "encoding_format": "float",
    }

    last_error = ""
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                EMBEDDINGS_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as error:  # network hiccup
            last_error = str(error)
            time.sleep(2 ** attempt)
            continue

        if response.status_code == 200:
            body = response.json()
            data = sorted(body["data"], key=lambda item: item.get("index", 0))
            return [item["embedding"] for item in data]

        last_error = f"HTTP {response.status_code}: {response.text[:300]}"
        # 429 = rate limit, 5xx = provider hiccup -> retry. Everything else is fatal.
        if response.status_code == 429 or response.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        raise EmbeddingError(f"OpenRouter embeddings failed. {last_error}")

    raise EmbeddingError(
        f"OpenRouter embeddings failed after {MAX_RETRIES} attempts. {last_error}"
    )


def _l2_normalize(vector: list[float]) -> list[float]:
    """
    Normalise to unit length so that ChromaDB's cosine distance is exactly
    `1 - cosine_similarity`. This is what lets Task 9 compare the raw dense
    score against a human-readable threshold like 0.48.
    """
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


# =============================================================================
# PUBLIC API
# =============================================================================

def embed_texts(
    texts: Sequence[str],
    batch_size: int = BATCH_SIZE,
    show_progress: bool = False,
) -> list[list[float]]:
    """
    Embed a list of texts with `baai/bge-m3`, using the on-disk cache.

    Args:
        texts: Raw strings (chunks or queries).
        batch_size: Number of texts per HTTP request.
        show_progress: Print a one-line progress counter (used by Task 4).

    Returns:
        List of L2-normalised 1024-dim vectors, aligned with `texts`.
    """
    if not texts:
        return []

    keys = [_cache_key(text, EMBEDDING_MODEL) for text in texts]
    cached = _cache_get_many(keys)

    missing_positions = [i for i, key in enumerate(keys) if key not in cached]
    if missing_positions and show_progress:
        print(
            f"  Embedding {len(missing_positions)} new / {len(texts)} total "
            f"({len(texts) - len(missing_positions)} from cache)"
        )

    fresh: list[tuple[str, list[float]]] = []
    for start in range(0, len(missing_positions), batch_size):
        window = missing_positions[start : start + batch_size]
        vectors = _post_embeddings([texts[i] for i in window])
        if len(vectors) != len(window):
            raise EmbeddingError(
                f"OpenRouter returned {len(vectors)} vectors for {len(window)} inputs"
            )
        for position, vector in zip(window, vectors):
            normalized = _l2_normalize(vector)
            cached[keys[position]] = normalized
            fresh.append((keys[position], normalized))
        if show_progress:
            done = min(start + batch_size, len(missing_positions))
            print(f"    ... {done}/{len(missing_positions)}", flush=True)

    if fresh:
        _cache_put_many(fresh)

    return [cached[key] for key in keys]


def embed_query(query: str) -> list[float]:
    """Embed a single query. bge-m3 is symmetric: no instruction prefix needed."""
    return embed_texts([query])[0]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Plain cosine similarity — used by MMR in Task 7."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


if __name__ == "__main__":
    print(f"Model: {EMBEDDING_MODEL} (dim={EMBEDDING_DIM})")
    print(f"Cache: {CACHE_PATH}  {cache_stats()}")
    samples = [
        "What is the tuition fee at RMIT Vietnam?",
        "Hoc phi tai RMIT Viet Nam la bao nhieu?",
        "How do I book a library study room?",
    ]
    vectors = embed_texts(samples, show_progress=True)
    print(f"\nReturned {len(vectors)} vectors of dim {len(vectors[0])}")
    print("\nCross-lingual sanity check (EN vs VI of the same question):")
    print(f"  sim(en_tuition, vi_tuition) = {cosine_similarity(vectors[0], vectors[1]):.4f}")
    print(f"  sim(en_tuition, library)    = {cosine_similarity(vectors[0], vectors[2]):.4f}")
