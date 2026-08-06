# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project at a glance

University Services RAG chatbot ("CampusIQ") — Day 8 of a 15-day lab series. Topic is fixed to RMIT Vietnam policy/services data crawled from `rmit.edu.vn`. The project ships two parallel deliverables:

1. **Starter lab (Tasks 1–10)** — a hand-rolled RAG pipeline organized as ten sequential tasks in `src/`, scored by `tests/test_individual.py`.
2. **Group project ("CampusIQ")** — a FastAPI backend (`backend/`) + React/Vite frontend (`frontend/`) wired to the same `src/task10_generation.py` entry point, with RAGAS evaluation under `group_project/evaluation/`.

The legacy Streamlit UI in `app.py` still imports `src.task10_generation.generate_with_citation` but is superseded by the FastAPI/React stack (see `DEMO.md`, `run_demo.ps1`).

## Quick commands

All commands assume the repo root. Python uses the bundled `.venv` if present; otherwise the system `python`.

### End-to-end demo (React + FastAPI)

```powershell
# First-time setup
python -m pip install -r requirements.txt
cd frontend; npm ci; cd ..
python -m src.task4_chunking_indexing        # build the ChromaDB index

# Run both servers (logs in .demo/)
.\run_demo.ps1
```

URLs once ready: frontend `http://127.0.0.1:5173`, Swagger `http://127.0.0.1:8000/docs`, health `http://127.0.0.1:8000/health`.

### Backend only

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend only

```bash
cd frontend
npm install
npm run dev          # vite dev server on :5173
npm run build        # tsc -b && vite build  -> frontend/dist
npm run typecheck    # tsc -b --pretty false
npm run host         # vite preview --host 127.0.0.1 --port 5173 --strictPort
```

Frontend reads `VITE_RAG_API_URL` from `frontend/.env.local` (`http://localhost:8000` for local dev; `same-origin` when FastAPI already serves the built bundle).

### Lab pipeline tasks (each is a runnable module)

```powershell
python -m src.task1_collect_legal_docs
python -m src.task2_crawl_news
python -m src.task3_convert_markdown
python -m src.task4_chunking_indexing     # --reset / --dry-run flags
python -m src.task5_semantic_search       # --query "..." --top-k 5
python -m src.task6_lexical_search        # --query "..." --top-k 5
python -m src.task7_reranking             # --method rrf|cross_encoder|mmr
python -m src.task8_pageindex_vectorless  # uses PAGEINDEX_API_KEY if set
python -m src.task9_retrieval_pipeline    # full hybrid + PageIndex fallback
python -m src.task10_generation           # end-to-end answer + citations
```

If you change the source corpus, delete `chroma_db/` (or pass `--rebuild`) before re-running task 4; otherwise the new docs are not picked up.

### Tests

```powershell
# Individual-task grading (Tasks 1–10, max 50 pts)
pytest tests/test_individual.py -v
pytest tests/test_individual.py::TestTask5 -v    # single task
pytest tests/test_individual.py::TestTask9 -v

# FastAPI contract + smoke tests (HTTP client)
pytest tests/test_backend_api.py -v
```

`tests/test_backend_api.py` hits the live FastAPI app; start the backend first or expect connection failures.

### Group project evaluation

```powershell
python -m group_project.evaluation.eval_pipeline
```

Inputs: `group_project/evaluation/golden_dataset.json` (15+ Q&A pairs). Outputs: per-metric RAGAS scores written to `group_project/evaluation/results.md`.

## Architecture

### Data flow

```
User -> React (frontend/)  ── /api/chat ──>  FastAPI (backend/)
                                            │
                                            ├─ services/rag.py (RagService)
                                            │     └─> src.task10_generation.generate_with_citation
                                            │             ├─> src.task9_retrieval_pipeline.retrieve
                                            │             │     ├─> src.task5_semantic_search  (dense cosine, OpenRouter bge-m3)
                                            │             │     ├─> src.task6_lexical_search   (BM25 over corpus)
                                            │             │     ├─> src.task7_reranking        (RRF / Jina cross-encoder / MMR)
                                            │             │     └─> src.task8_pageindex_vectorless  (hosted PageIndex or local structural fallback)
                                            │             ├─> reorder_for_llm (front + back[::-1], anti "lost in the middle")
                                            │             ├─> format_context (numbered [n] labels for citations)
                                            │             └─> LLM (OpenAI SDK: OpenAI key first, OpenRouter fallback)
                                            ├─ GET /api/documents  -> ChromaDB corpus (src.task4_chunking_indexing.get_collection)
                                            └─ GET /health         -> component readiness (chroma / llm / pageindex)
```

### Module responsibilities

- `src/task1..3` — ingest: download ≥3 policy PDFs to `data/landing/legal/`, crawl ≥5 news pages to `data/landing/news/`, convert all to markdown in `data/standardized/`.
- `src/task4_chunking_indexing.py` — chunk (size 800 / overlap 100), embed via OpenRouter `baai/bge-m3` (1024-dim), persist to `chroma_db/` collection `university_services_docs`. Exports `get_collection(create: bool)` used by the backend's `/api/documents`.
- `src/embedding_client.py` — single place that talks to OpenRouter embeddings (`OPENROUTER_BASE_URL`, batching, retry). Imported by tasks 4 and 5.
- `src/task5_semantic_search.py` — dense retrieval + optional HyDE via OpenRouter LLM.
- `src/task6_lexical_search.py` — BM25 sparse retrieval.
- `src/task7_reranking.py` — `rerank_rrf` (default), optional Jina cross-encoder when `JINA_API_KEY` is set, MMR for diversity.
- `src/task8_pageindex_vectorless.py` — uses hosted PageIndex when `PAGEINDEX_API_KEY` is set, otherwise an offline structural retriever over the markdown headings.
- `src/task9_retrieval_pipeline.py` — fuses dense + sparse with RRF, applies second-stage rerank, and falls back to PageIndex when `dense_results[0]["score"] < SCORE_THRESHOLD` (0.511, calibrated on this corpus). **The threshold MUST compare against the raw cosine score, not the RRF score** — RRF maxes out near 1/(k+1) ≈ 0.016 and will never trigger the fallback otherwise. The docstring at the top of the file explains the trap.
- `src/task10_generation.py` — public entry point consumed by both `app.py` and `backend/services/rag.py`. Returns `{"answer": str, "sources": list[dict], "retrieval_source": "hybrid"|"pageindex"|"none"}`. `sources` order matches the numbered context so `[n]` citations in the answer map to `sources[n-1]`.

### Backend

- `backend/config.py` — frozen `Settings` dataclass; loads `.env` once, `lru_cache`-ed.
- `backend/schemas.py` — Pydantic models for `ChatRequest`, `RagResponse`, `SourceDocument`, `HealthResponse`. `SourceDocument.category` is `"LEGAL"` or `"NEWS"`, `method` is `"Hybrid" | "Semantic" | "BM25" | "PageIndex"`.
- `backend/services/rag.py` — `RagService` is the only adapter between Task 10's dict shape and the API contract. Raises `RagPipelineNotReady` (→ HTTP 503) when `NotImplementedError` comes from a stub task; any other failure → HTTP 500.
- `backend/main.py` — CORS allow-list from `BACKEND_CORS_ORIGINS` (defaults to the Vite dev origins). Mounts `/assets` only if `frontend/dist/assets/` exists, otherwise the API runs headless and the frontend must be on its own dev server.

### Frontend

React 19 + Vite + TypeScript + Motion. Five views (`assistant`, `library`, `evaluation`, `system`, defaulting to `assistant`); theme toggle with view-transition animation; conversation history is browser-local under key `campusiq:conversations:v1` (not sent to the backend).

Key components: `App.tsx` (orchestrator, 30 s backend polling, conversation lifecycle), `services/rag-client.ts` (typed HTTP client), `services/conversation-store.ts` (localStorage), and per-view components under `components/`. All API keys live exclusively in the Python backend; the frontend only reads `VITE_RAG_API_URL`.

## Environment

Copy `.env.example` → `.env`. Variables consumed:

| Var | Used by | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | task 4/5 embeddings, task 10 generation (fallback) | Required for embeddings; optional for generation if `OPENAI_API_KEY` is set |
| `OPENAI_API_KEY` | task 10 generation | Preferred generation provider (skips `openai/` prefix in `LLM_MODEL`) |
| `LLM_MODEL` | task 10 | Default `gpt-4o-mini`; use any OpenRouter id (e.g. `openai/gpt-4o-mini`) |
| `OPENROUTER_BASE_URL` | tasks 4/5/10 | Override for OpenRouter-compatible proxies |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` / `EMBEDDING_BATCH_SIZE` | task 4/5 | Defaults: `baai/bge-m3`, 1024, 32 |
| `HYDE_MODEL` | task 5 | Defaults to `LLM_MODEL` |
| `JINA_API_KEY` | task 7 | Enables cross-encoder rerank; otherwise RRF only |
| `PAGEINDEX_API_KEY` | task 8 / `/health` | Enables hosted PageIndex; otherwise local structural fallback |
| `BACKEND_CORS_ORIGINS` | backend | Comma-separated origins, default Vite dev ports |
| `CHROMA_DB_PATH` / `CHROMA_COLLECTION_NAME` | task 4, backend | Defaults: `chroma_db`, `university_services_docs` |
| `BACKEND_APP_NAME` / `BACKEND_APP_VERSION` | backend | Identity in `/health` and `/docs` |

When the project is served together (`frontend/dist` mounted by FastAPI), the frontend can be reached on `:8000` and `VITE_RAG_API_URL=same-origin` works. In dev they are split: backend on `:8000`, Vite on `:5173` → `VITE_RAG_API_URL=http://localhost:8000`.

## Testing & grading contract

- `tests/test_individual.py` reads `data/` and imports directly from `src/`. Several tasks raise `NotImplementedError` until filled in — the tests skip rather than fail when that happens, but scoring requires the implementation.
- `tests/test_backend_api.py` exercises the FastAPI contract using `httpx`. It depends on a live backend and on `chroma_db/` existing; run `python -m src.task4_chunking_indexing` first or expect collection-empty failures.
- The 7-checkpoint schedule in `LAB_GUIDE.md` and `checkpoint_timer.html` totals 180 min: CP0 setup, CP1 data (tasks 1–3), CP2 retrieval (tasks 4–6), CP3 rerank + fallback (tasks 7–8), CP4 hybrid pipeline + generation (tasks 9–10, 50 pts), CP5 group chatbot + RAGAS, CP6 demo.

## Common pitfalls (from the LAB_GUIDE troubleshooting table)

- `MissingDependencyException` on Task 3 → install `markitdown[pdf]`.
- Task 2 crawl fails on Chromium → `playwright install chromium`.
- Windows console encoding errors → `$env:PYTHONIOENCODING="utf-8"` or `python -X utf8`.
- PageIndex fallback never triggers → you compared RRF score to the threshold; use raw cosine (`dense_results[0]["score"]`) instead. Threshold 0.511 is calibrated for this RMIT corpus — re-measure if you change the embedding model or corpus.
- RAGAS rate-limit on OpenRouter free tier → shrink `golden_dataset.json` during experiments.
- Stale chunks after changing the corpus → delete `chroma_db/` and rerun task 4.

## Pointers

- Lab overview, role split, grading rubric: `README.md`, `LAB_GUIDE.md`, `checkpoint_timer.html`.
- Demo launcher + sample queries: `DEMO.md`, `run_demo.ps1`.
- Glossary (RRF, HyDE, lost-in-the-middle, etc.): `LAB_GUIDE.md` §1.
- Evaluation framework choice (RAGAS / DeepEval / TruLens) and A/B comparison requirements: `README.md` "Bài Tập Nhóm" §Yêu cầu 2 and `group_project/README.md`.
- Cross-team notes: `docs/role3-role4-implementation.md`.