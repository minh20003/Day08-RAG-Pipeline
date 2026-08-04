"""
Task 2 — Crawl bài viết/thông báo về dịch vụ đại học.

Hướng dẫn:
    1. Crawl tối thiểu 5 bài viết từ trang công khai của một trường đại học.
    2. Sử dụng Crawl4AI hoặc thư viện crawling tương tự.
    3. Lưu output vào data/landing/news/.
    4. Mỗi bài lưu 1 file JSON với metadata (url, title, date_crawled, content).

Chạy từ thư mục gốc repo:
    python -m src.task2_crawl_news

Script ưu tiên Crawl4AI. Nếu Crawl4AI/Chromium chưa sẵn sàng, script tự chuyển sang
HTTP crawler dựa trên requests + HTMLParser để bài lab vẫn chạy được.
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

import requests

DATA_DIR = Path(__file__).parent.parent / "data" / "landing" / "news"
REQUEST_TIMEOUT_SECONDS = 45
MIN_CONTENT_LENGTH = 500
REQUEST_HEADERS = {
    "User-Agent": "University-Services-RAG-Lab/1.0 (educational data collection)",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
}

# Các URL đã được kiểm tra trên website chính thức RMIT Vietnam.
ARTICLE_URLS = [
    (
        "https://www.rmit.edu.vn/news/all-news/2026/jan/"
        "rmit-vietnam-announces-record-2026-scholarships-worth-more-than-200-billion-vnd"
    ),
    (
        "https://www.rmit.edu.vn/students/student-news-and-events/student-news/2026/"
        "newbie-101-unlock-library-power"
    ),
    (
        "https://www.rmit.edu.vn/students/student-news-and-events/"
        "student-events-2026/careers-festival"
    ),
    (
        "https://www.rmit.edu.vn/study-at-rmit/international-students/"
        "international-student-support-services"
    ),
    "https://www.rmit.edu.vn/students/support/student-academic-success",
]


def setup_directory() -> None:
    """Tạo thư mục data/landing/news/ nếu chưa có."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def validate_rmit_url(url: str) -> None:
    """Chỉ cho phép crawl HTTPS URL thuộc domain chính thức của RMIT."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (
        hostname == "rmit.edu.vn" or hostname.endswith(".rmit.edu.vn")
    ):
        raise ValueError(f"URL không thuộc domain HTTPS chính thức của RMIT: {url}")


def output_filename(url: str, index: int) -> str:
    """Tạo tên JSON rõ nghĩa và ổn định từ slug của URL."""
    slug = urlparse(url).path.rstrip("/").split("/")[-1]
    safe_slug = re.sub(r"[^a-z0-9-]+", "-", slug.lower()).strip("-")
    return f"article_{index:02d}_{safe_slug[:80]}.json"


def normalise_markdown(text: str) -> str:
    """Chuẩn hóa whitespace nhưng vẫn giữ cấu trúc heading/list của Markdown."""
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    output: list[str] = []
    previous_blank = True

    for line in lines:
        if not line:
            if not previous_blank:
                output.append("")
            previous_blank = True
            continue
        output.append(line)
        previous_blank = False

    return "\n".join(output).strip()


class RMITPageParser(HTMLParser):
    """Bộ trích xuất HTML nhẹ dùng khi Crawl4AI chưa được cài đặt."""

    BLOCK_TAGS = {"article", "div", "p", "section", "table", "tr", "ul", "ol"}
    IGNORED_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "form"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.meta_title = ""
        self.published_date = ""
        self.body_parts: list[str] = []
        self.main_parts: list[str] = []
        self.in_title = False
        self.in_body = False
        self.in_main = False
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = {key.lower(): value or "" for key, value in attrs}

        if tag == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").lower()
            content = attr_map.get("content", "").strip()
            if key in {"og:title", "twitter:title"} and content:
                self.meta_title = content
            if key in {"article:published_time", "date", "datepublished"} and content:
                self.published_date = content
            return

        if tag == "title":
            self.in_title = True
        if tag == "body":
            self.in_body = True
        if tag == "main":
            self.in_main = True
        if tag in self.IGNORED_TAGS:
            self.ignored_depth += 1

        if self.ignored_depth or not self.in_body:
            return

        if re.fullmatch(r"h[1-6]", tag):
            self._append(f"\n\n{'#' * int(tag[1])} ")
        elif tag == "li":
            self._append("\n- ")
        elif tag == "br":
            self._append("\n")
        elif tag in self.BLOCK_TAGS:
            self._append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.IGNORED_TAGS and self.ignored_depth:
            self.ignored_depth -= 1
            return

        if not self.ignored_depth and self.in_body and (
            tag in self.BLOCK_TAGS or re.fullmatch(r"h[1-6]", tag)
        ):
            self._append("\n")

        if tag == "title":
            self.in_title = False
        if tag == "main":
            self.in_main = False
        if tag == "body":
            self.in_body = False

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self.in_title:
            self.title_parts.append(text)
        if self.in_body and not self.ignored_depth:
            self._append(text + " ")

    def _append(self, text: str) -> None:
        self.body_parts.append(text)
        if self.in_main:
            self.main_parts.append(text)

    @property
    def title(self) -> str:
        return self.meta_title or " ".join(self.title_parts).strip() or "Unknown"

    @property
    def markdown(self) -> str:
        main_content = normalise_markdown("".join(self.main_parts))
        if len(main_content) >= MIN_CONTENT_LENGTH:
            return main_content
        return normalise_markdown("".join(self.body_parts))


def crawl_article_with_http(url: str) -> dict:
    """HTTP fallback tương thích yêu cầu Task 2 khi Crawl4AI chưa sẵn sàng."""
    response = requests.get(
        url,
        headers=REQUEST_HEADERS,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "").lower()
    if "html" not in content_type:
        raise ValueError(f"URL không trả về HTML (Content-Type: {content_type})")

    parser = RMITPageParser()
    parser.feed(response.text)
    content_markdown = parser.markdown
    if len(content_markdown) < MIN_CONTENT_LENGTH:
        raise ValueError(
            f"Nội dung trích xuất quá ngắn: {len(content_markdown)} ký tự"
        )

    return {
        "url": url,
        "title": parser.title,
        "published_date": parser.published_date or None,
        "date_crawled": datetime.now(timezone.utc).isoformat(),
        "content_markdown": content_markdown,
        "crawler": "requests-htmlparser-fallback",
    }


async def crawl_article(url: str) -> dict:
    """Crawl một bài viết RMIT và trả metadata cùng nội dung Markdown."""
    validate_rmit_url(url)

    try:
        from crawl4ai import AsyncWebCrawler
    except ImportError:
        return await asyncio.to_thread(crawl_article_with_http, url)

    try:
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url)
        if hasattr(result, "success") and not result.success:
            raise RuntimeError(getattr(result, "error_message", "Crawl4AI failed"))

        metadata = getattr(result, "metadata", {}) or {}
        markdown_result = getattr(result, "markdown", "")
        content_markdown = getattr(
            markdown_result, "raw_markdown", markdown_result
        )
        content_markdown = normalise_markdown(str(content_markdown))
        if len(content_markdown) < MIN_CONTENT_LENGTH:
            raise ValueError("Crawl4AI trả về nội dung quá ngắn")

        return {
            "url": url,
            "title": metadata.get("title", "Unknown"),
            "published_date": (
                metadata.get("article:published_time")
                or metadata.get("date")
                or None
            ),
            "date_crawled": datetime.now(timezone.utc).isoformat(),
            "content_markdown": content_markdown,
            "crawler": "crawl4ai",
        }
    except Exception as error:
        print(f"  ⚠ Crawl4AI không sẵn sàng ({error}); chuyển sang HTTP fallback")
        return await asyncio.to_thread(crawl_article_with_http, url)


async def crawl_all() -> list[Path]:
    """Crawl toàn bộ ARTICLE_URLS, lưu mỗi bài thành một JSON UTF-8."""
    setup_directory()
    saved_files: list[Path] = []
    failures: list[str] = []

    for index, url in enumerate(ARTICLE_URLS, 1):
        print(f"[{index}/{len(ARTICLE_URLS)}] Crawling: {url}")
        try:
            article = await crawl_article(url)
            filepath = DATA_DIR / output_filename(url, index)
            temporary_path = filepath.with_suffix(".json.tmp")
            temporary_path.write_text(
                json.dumps(article, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary_path.replace(filepath)
            saved_files.append(filepath)
            print(f"  ✓ Saved: {filepath.name} ({len(article['content_markdown']):,} chars)")
        except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
            failures.append(f"{url}: {error}")
            print(f"  ✗ Failed: {error}")

    if failures:
        details = "\n- ".join(failures)
        raise RuntimeError(f"Crawl chưa hoàn tất:\n- {details}")

    return saved_files


if __name__ == "__main__":
    files = asyncio.run(crawl_all())
    print(f"✓ Hoàn thành Task 2: {len(files)} bài RMIT trong {DATA_DIR}")
