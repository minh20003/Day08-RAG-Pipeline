# FastAPI RAG backend

Backend này cung cấp HTTP contract cho frontend và làm adapter tới pipeline trong
`src/task10_generation.py`.

## Chạy local

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Swagger UI: `http://localhost:8000/docs`  
Health check: `http://localhost:8000/health`

Để frontend gọi backend thật, tạo `frontend/.env.local`:

```env
VITE_RAG_API_URL=http://localhost:8000
```

## Endpoint chat

`POST /api/chat`

```json
{
  "message": "Điều kiện nhận học bổng là gì?",
  "conversation_id": "optional-conversation-id",
  "top_k": 5,
  "use_reranking": true
}
```

Route gọi `generate_with_citation()` trong Task 10 và chuẩn hóa kết quả sang
`RagResponse` mà frontend đang dùng. Trong lúc Task 4–10 chưa hoàn thiện, route trả
HTTP `503` với code `rag_pipeline_not_ready`.

## Cấu hình

Các biến có thể thêm vào `.env`:

```env
BACKEND_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CHROMA_DB_PATH=chroma_db
CHROMA_COLLECTION_NAME=university_services_docs
```

