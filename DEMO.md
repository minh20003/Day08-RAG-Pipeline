# CampusIQ end-to-end demo

Luồng demo đã được nối hoàn chỉnh:

```text
React (Vite)
  -> FastAPI /api/chat
  -> Task 10: context + numeric citations + OpenAI
  -> Task 9: Dense BGE-M3 + BM25 + RRF
  -> PageIndex fallback khi cosine < 0.511
  -> ChromaDB corpus (364 chunks)
```

## Chuẩn bị lần đầu

```powershell
python -m pip install -r requirements.txt
Set-Location frontend
npm ci
Set-Location ..
python -m src.task4_chunking_indexing
```

Trong `.env`, cấu hình `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
`PAGEINDEX_API_KEY` và `LLM_MODEL`. File `frontend/.env.local` phải chứa:

```env
VITE_RAG_API_URL=http://localhost:8000
```

## Chạy demo

```powershell
.\run_demo.ps1
```

Sau khi launcher báo ready:

- Frontend: `http://127.0.0.1:5173`
- Swagger: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/health`

Nhấn Enter trong terminal chạy launcher để dừng đúng hai server demo.

## Câu hỏi gợi ý

- `Học phí tại RMIT Vietnam được thanh toán như thế nào?`
- `Điều kiện nhận học bổng dành cho sinh viên quốc tế là gì?`
- `Làm sao để đặt phòng học nhóm ở thư viện?`
