# CampusIQ Frontend

React/Vite frontend cho University Services RAG của Team B4. Ứng dụng luôn dùng RAG API thật; nếu backend không sẵn sàng, giao diện hiển thị trạng thái kết nối và nút thử lại thay vì tạo dữ liệu giả.

## Chạy local

```bash
npm install
npm run dev
```

Tạo `frontend/.env.local` để trỏ tới backend local, ví dụ:

```env
VITE_RAG_API_URL=http://localhost:8000
```

Với bản FastAPI đã phục vụ sẵn frontend build, dùng `VITE_RAG_API_URL=same-origin`.

## Build production

```bash
npm run build
```

FastAPI sẽ phục vụ `frontend/dist`; Cloudflare Tunnel chỉ cần trỏ tới tiến trình FastAPI đã chạy trên cổng được cấu hình.

## API

- `GET /health` — health, service/version và component readiness.
- `GET /api/documents` — corpus ChromaDB thực tế.
- `POST /api/chat` — câu trả lời, evidence và retrieval trace.

API key của OpenRouter, PageIndex, embedding model hoặc dịch vụ khác chỉ nằm trong Python backend.

## Các view

- Trợ lý AI: chat thật, citation theo từng câu trả lời và source inspector.
- Kho tài liệu: corpus thật, tìm kiếm/lọc metadata và trạng thái tải dữ liệu.
- RAG Analytics: corpus, trace, latency và citation telemetry từ các truy vấn thật trên thiết bị.
- Trạng thái hệ thống: health API, public origin, HTTPS, corpus và lần kiểm tra gần nhất.

Hội thoại thật gần đây được lưu riêng trên trình duyệt dưới `campusiq:conversations:v1`; không được gửi sang backend để lưu trữ.
