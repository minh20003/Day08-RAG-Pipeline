"""
Task 1 — Thu thập văn bản chính sách/quy định dịch vụ đại học.

Hướng dẫn:
    1. Tìm tối thiểu 3 văn bản chính sách (PDF/DOCX) từ trang công khai của một trường đại học.
    2. Tải về và lưu vào data/landing/legal/
    3. Đặt tên file rõ ràng, không dấu, mô tả đúng nội dung.

Gợi ý nguồn (ví dụ trang công khai RMIT Vietnam — rmit.edu.vn):
    - https://www.rmit.edu.vn/study-at-rmit/tuition-fees
    - https://www.rmit.edu.vn/study-at-rmit/scholarships/...
    - https://www.rmit.edu.vn/students/my-studies/fees-and-payments

Gợi ý văn bản (chủ đề dịch vụ đại học):
    - Học phí & phương thức thanh toán (Tuition Fees)
    - Chính sách học bổng (Scholarship eligibility)
    - Quy định ký túc xá / hỗ trợ chỗ ở (Accommodation Services)
    - Hướng dẫn đăng ký học phần qua cổng thông tin sinh viên (Course Registration)

Lưu ý: một số trang trường (vd VinUni, Fulbright) chặn bot crawler mặc định (HTTP 403) —
không phải lỗi của bạn, đó là cấu hình WAF/Cloudflare phía server. Đổi sang trang khác
thay vì cố vượt qua, và chỉ dùng nguồn công khai/được phép chia sẻ.
"""

from pathlib import Path

import requests

DATA_DIR = Path(__file__).parent.parent / "data" / "landing" / "legal"

# Các đường dẫn dưới đây được lấy từ những trang công khai trên rmit.edu.vn.
# Chúng là file PDF trực tiếp, không phải trang HTML, nên phù hợp với yêu cầu Task 1.
LEGAL_DOCUMENTS = (
    {
        "filename": "student-fees-and-charges-guide-rmit-2026.pdf",
        "topic": "Học phí, phụ phí và phương thức thanh toán",
        "url": (
            "https://www.rmit.edu.vn/assets/vn/en/assets-for-production/"
            "documents/pdfs/study-at-rmit/tuition-fees/"
            "student-fees-and-charges-guide-06-2026.pdf"
        ),
    },
    {
        "filename": "scholarship-terms-and-conditions-rmit.pdf",
        "topic": "Điều khoản và điều kiện học bổng",
        "url": (
            "https://www.rmit.edu.vn/content/dam/rmit/vn/en/"
            "assets-for-production/documents/pdfs/study-at-rmit/scholarships/"
            "english-pdf/rmit-university-vietnam-scholarship-terms-and-conditions.pdf"
        ),
    },
    {
        "filename": "accommodation-advice-international-students-rmit.pdf",
        "topic": "Hướng dẫn chỗ ở cho sinh viên quốc tế",
        "url": (
            "https://www.rmit.edu.vn/content/dam/rmit/vn/en/"
            "assets-for-production/documents/pdfs/students/accommodation/"
            "accommodation-advice-for-international-students-in-vietnam.pdf"
        ),
    },
)

MIN_FILE_SIZE_BYTES = 1024
REQUEST_TIMEOUT_SECONDS = 45
REQUEST_HEADERS = {
    "User-Agent": "University-Services-RAG-Lab/1.0 (educational data collection)",
    "Accept": "application/pdf,*/*;q=0.8",
}


def setup_directory():
    """Tạo thư mục data/landing/legal/ nếu chưa có."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✓ Thư mục đã sẵn sàng: {DATA_DIR}")


def is_valid_pdf(filepath: Path) -> bool:
    """Kiểm tra file tải về là PDF và đáp ứng ngưỡng kích thước của bài lab."""
    if not filepath.is_file() or filepath.stat().st_size <= MIN_FILE_SIZE_BYTES:
        return False

    with filepath.open("rb") as pdf_file:
        return pdf_file.read(5) == b"%PDF-"


def download_file(url: str, filename: str, timeout: int = REQUEST_TIMEOUT_SECONDS) -> Path:
    """Tải một PDF công khai, ghi atomically và xác thực trước khi lưu chính thức."""
    if Path(filename).name != filename or Path(filename).suffix.lower() != ".pdf":
        raise ValueError("filename phải là tên file PDF an toàn, không chứa đường dẫn con")

    destination = DATA_DIR / filename
    temporary_destination = destination.with_suffix(".pdf.part")

    try:
        with requests.get(
            url,
            headers=REQUEST_HEADERS,
            timeout=timeout,
            stream=True,
        ) as response:
            response.raise_for_status()
            with temporary_destination.open("wb") as output_file:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        output_file.write(chunk)

        if not is_valid_pdf(temporary_destination):
            content_type = response.headers.get("Content-Type", "unknown")
            raise ValueError(
                f"URL không trả về PDF hợp lệ (Content-Type: {content_type})"
            )

        temporary_destination.replace(destination)
        print(f"✓ Đã tải: {destination.name} ({destination.stat().st_size:,} bytes)")
        return destination
    except Exception:
        temporary_destination.unlink(missing_ok=True)
        raise


def download_legal_documents(force: bool = False) -> list[Path]:
    """Tải ba tài liệu chính sách RMIT; bỏ qua PDF hợp lệ đã tồn tại trừ khi force."""
    setup_directory()
    downloaded_files: list[Path] = []
    failures: list[str] = []

    for document in LEGAL_DOCUMENTS:
        destination = DATA_DIR / document["filename"]
        if not force and is_valid_pdf(destination):
            print(f"↷ Đã có file hợp lệ: {destination.name}")
            downloaded_files.append(destination)
            continue

        print(f"↓ Đang tải {document['topic']}...")
        try:
            downloaded_files.append(download_file(document["url"], document["filename"]))
        except (requests.RequestException, OSError, ValueError) as error:
            failures.append(f"{document['filename']}: {error}")
            print(f"✗ Không thể tải {document['filename']}: {error}")

    if failures:
        details = "\n- ".join(failures)
        raise RuntimeError(f"Tải tài liệu chưa hoàn tất:\n- {details}")

    return downloaded_files


if __name__ == "__main__":
    files = download_legal_documents()
    print(f"✓ Hoàn thành Task 1: {len(files)} PDF hợp lệ trong {DATA_DIR}")
