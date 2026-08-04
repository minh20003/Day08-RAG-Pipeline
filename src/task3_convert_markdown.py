"""
Task 3 — Convert toàn bộ file trong data/landing/ thành Markdown.

Sử dụng MarkItDown của Microsoft:
    https://github.com/microsoft/markitdown

Cài đặt:
    pip install "markitdown[pdf]"
    # Lưu ý: cần extra [pdf] để convert được file PDF. Chỉ "pip install markitdown"
    # (không có extra) sẽ báo MissingDependencyException khi convert PDF, dù JSON/DOCX
    # vẫn convert bình thường.

Hướng dẫn:
    1. Scan toàn bộ file trong data/landing/ (PDF, DOCX, JSON)
    2. Convert sang Markdown
    3. Lưu vào data/standardized/ giữ nguyên cấu trúc thư mục
"""

import json
from pathlib import Path

LANDING_DIR = Path(__file__).parent.parent / "data" / "landing"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "standardized"
SUPPORTED_LEGAL_EXTENSIONS = {".pdf", ".docx", ".doc"}


def create_converter():
    """Khởi tạo MarkItDown với thông báo cài đặt rõ ràng khi thiếu PDF extra."""
    try:
        from markitdown import MarkItDown
    except ImportError as error:
        raise RuntimeError(
            'Thiếu MarkItDown. Hãy chạy: pip install "markitdown[pdf]"'
        ) from error

    return MarkItDown()


def write_markdown(output_path: Path, content: str) -> Path:
    """Ghi Markdown UTF-8 atomically để tránh để lại file dở khi có lỗi."""
    content = content.strip()
    if not content:
        raise ValueError(f"Nội dung Markdown rỗng: {output_path.name}")

    temporary_path = output_path.with_suffix(".md.tmp")
    temporary_path.write_text(content + "\n", encoding="utf-8")
    temporary_path.replace(output_path)
    return output_path


def convert_legal_docs() -> list[Path]:
    """Convert PDF/DOCX files trong data/landing/legal/ sang markdown."""
    legal_dir = LANDING_DIR / "legal"
    output_dir = OUTPUT_DIR / "legal"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not legal_dir.exists():
        raise FileNotFoundError(f"Không tìm thấy thư mục legal: {legal_dir}")

    converter = create_converter()
    converted_files: list[Path] = []

    for filepath in sorted(legal_dir.iterdir()):
        if filepath.is_file() and filepath.suffix.lower() in SUPPORTED_LEGAL_EXTENSIONS:
            print(f"Converting: {filepath.name}")
            result = converter.convert(str(filepath))
            output_path = output_dir / f"{filepath.stem}.md"
            converted_files.append(write_markdown(output_path, result.text_content))
            print(f"  ✓ Saved: {output_path}")

    if not converted_files:
        raise ValueError(f"Không có PDF/DOCX/DOC để convert trong {legal_dir}")

    return converted_files


def convert_news_articles() -> list[Path]:
    """Convert JSON crawled articles trong data/landing/news/ sang markdown."""
    news_dir = LANDING_DIR / "news"
    output_dir = OUTPUT_DIR / "news"
    output_dir.mkdir(parents=True, exist_ok=True)

    if not news_dir.exists():
        raise FileNotFoundError(f"Không tìm thấy thư mục news: {news_dir}")

    converted_files: list[Path] = []

    for filepath in sorted(news_dir.iterdir()):
        if filepath.is_file() and filepath.suffix.lower() == ".json":
            print(f"Converting: {filepath.name}")
            data = json.loads(filepath.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError(f"JSON phải chứa object: {filepath.name}")

            title = str(data.get("title") or "Unknown").strip()
            source_url = str(data.get("url") or "N/A").strip()
            published_date = str(data.get("published_date") or "N/A").strip()
            crawled_date = str(data.get("date_crawled") or "N/A").strip()
            article_content = str(data.get("content_markdown") or "").strip()
            if not article_content:
                raise ValueError(f"{filepath.name} thiếu content_markdown")

            header = (
                f"# {title}\n\n"
                f"**Source:** {source_url}\n\n"
                f"**Published:** {published_date}\n\n"
                f"**Crawled:** {crawled_date}\n\n"
                "---\n\n"
            )
            output_path = output_dir / f"{filepath.stem}.md"
            converted_files.append(
                write_markdown(output_path, header + article_content)
            )
            print(f"  ✓ Saved: {output_path}")

    if not converted_files:
        raise ValueError(f"Không có JSON để convert trong {news_dir}")

    return converted_files


def convert_all() -> dict[str, list[Path]]:
    """Convert toàn bộ files."""
    print("=" * 50)
    print("Task 3: Convert to Markdown (MarkItDown)")
    print("=" * 50)

    print("\n--- Legal Documents ---")
    legal_files = convert_legal_docs()

    print("\n--- News Articles ---")
    news_files = convert_news_articles()

    total = len(legal_files) + len(news_files)
    print(f"\n✓ Done! Đã convert {total} files. Output tại: {OUTPUT_DIR}")
    return {"legal": legal_files, "news": news_files}


if __name__ == "__main__":
    convert_all()
