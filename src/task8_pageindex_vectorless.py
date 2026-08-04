"""
Task 8 — Vectorless RAG / PageIndex fallback.   [Role 4]

Run:
    python -m src.task8_pageindex_vectorless --upload       # md -> pdf -> PageIndex
    python -m src.task8_pageindex_vectorless -q "tuition fee"
    python -m src.task8_pageindex_vectorless --engine local -q "tuition fee"

-----------------------------------------------------------------------------
WHAT THIS IS FOR
-----------------------------------------------------------------------------
Task 9 calls this when dense retrieval's top-1 cosine is below the threshold —
i.e. when the vector index has nothing convincing. Vectorless retrieval attacks
the same corpus a completely different way: instead of comparing embeddings of
fixed-size chunks, it walks the document's STRUCTURE (title -> section ->
sub-section) the way a human flips to a chapter, so it is not affected by
whatever made the embedding search fail (an unusual phrase, a rare acronym, a
number that embeddings smear away).

-----------------------------------------------------------------------------
TWO ENGINES, ONE INTERFACE
-----------------------------------------------------------------------------
* engine="pageindex" — the hosted PageIndex API (https://pageindex.ai).
  Used automatically as soon as PAGEINDEX_API_KEY is present in .env.
  Flow: markdown -> PDF (PageIndex ingests PDFs, not .md) -> submit_document
  -> submit_query -> poll get_retrieval until status == "completed".

* engine="local" — an offline reasoning-free reimplementation of the same idea,
  used when there is no API key. It parses every data/standardized/**.md into a
  heading tree, scores each SECTION (not chunk) with IDF-weighted query-term
  coverage plus a heading-match bonus, and returns whole sections.

Both return the same shape and both set `source: "pageindex"` so Task 9 and the
tests can treat them interchangeably; `metadata["engine"]` records which one ran.

⚠ PageIndex's /retrieval API is flagged deprecated (it still works but the
  response carries a "deprecation" field) and its payload nests results as
  retrieved_nodes[].relevant_contents[][] . The parser below is written
  defensively and `--raw` prints the untouched JSON so you can re-check the
  schema instead of trusting an old code sample.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PAGEINDEX_API_KEY = os.getenv("PAGEINDEX_API_KEY", "").strip()
STANDARDIZED_DIR = Path(__file__).parent.parent / "data" / "standardized"
PROJECT_ROOT = Path(__file__).parent.parent
DOC_ID_CACHE = PROJECT_ROOT / "pageindex_doc_ids.json"
PDF_CACHE_DIR = PROJECT_ROOT / "pageindex_pdfs"

POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 180

# Sections shorter than this are headings with no body — not worth returning.
MIN_SECTION_CHARS = 120
MAX_SECTION_CHARS = 2000    # trim very long sections before they hit the LLM


def _placeholder(value: str) -> bool:
    return not value or value.startswith("pix_...") or value.lower() == "none"


def has_api_key() -> bool:
    return not _placeholder(PAGEINDEX_API_KEY)


# =============================================================================
# LOCAL STRUCTURAL ENGINE (works with no API key)
# =============================================================================

_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)
_HEADING_PATTERN = re.compile(r"^(#{1,4})\s+(.+?)\s*$", re.MULTILINE)

_STOPWORDS = {
    "the", "a", "an", "of", "for", "to", "in", "on", "at", "is", "are", "do",
    "does", "how", "what", "when", "where", "which", "who", "and", "or", "i",
    "my", "can", "with", "about", "there", "it", "be", "as", "by", "from",
    "la", "gi", "co", "cua", "va", "cho", "nao", "the", "bao", "nhieu", "lam",
    "sao", "toi", "duoc", "khong", "o", "tai", "nhu",
}

_document_tree_cache: list[dict] | None = None


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_PATTERN.findall(text.lower()) if t not in _STOPWORDS]


def build_document_tree(force_reload: bool = False) -> list[dict]:
    """
    Parse every standardized markdown file into a flat list of sections that
    remembers its heading path — the "structure" a vectorless engine reasons over.

    Returns:
        List of {'doc', 'doc_type', 'title', 'heading_path', 'level', 'text'}
    """
    global _document_tree_cache
    if _document_tree_cache is not None and not force_reload:
        return _document_tree_cache

    sections: list[dict] = []
    if not STANDARDIZED_DIR.exists():
        _document_tree_cache = sections
        return sections

    # Same heading-recovery step as Task 4: the legal PDFs have no markdown
    # headings, only numbered clauses. Without this the "structure" we navigate
    # would be a single blob per legal document.
    from .task4_chunking_indexing import clean_markdown, promote_numbered_headings

    for md_file in sorted(STANDARDIZED_DIR.rglob("*.md")):
        text = promote_numbered_headings(clean_markdown(md_file.read_text(encoding="utf-8")))
        matches = list(_HEADING_PATTERN.finditer(text))
        doc_title = matches[0].group(2).strip() if matches else md_file.stem
        doc_type = md_file.parent.name

        if not matches:
            sections.append(
                {
                    "doc": md_file.name,
                    "doc_type": doc_type,
                    "title": doc_title,
                    "heading_path": doc_title,
                    "level": 1,
                    "text": text.strip(),
                }
            )
            continue

        # Maintain the heading stack so each section knows its ancestors.
        stack: list[tuple[int, str]] = []
        for i, match in enumerate(matches):
            level = len(match.group(1))
            heading = match.group(2).strip()
            body_start = match.end()
            body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            body = text[body_start:body_end].strip()

            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, heading))
            heading_path = " > ".join(name for _, name in stack)

            if len(body) < MIN_SECTION_CHARS:
                continue
            sections.append(
                {
                    "doc": md_file.name,
                    "doc_type": doc_type,
                    "title": doc_title,
                    "heading_path": heading_path,
                    "level": level,
                    "text": body[:MAX_SECTION_CHARS],
                }
            )

    _document_tree_cache = sections
    return sections


def local_structural_search(query: str, top_k: int = 5) -> list[dict]:
    """
    Vectorless section retrieval: IDF-weighted query-term coverage over whole
    sections, with a x2 boost when a term appears in the heading path (a heading
    match is far stronger evidence than a body match — that is the "read the
    table of contents first" heuristic PageIndex is built on).
    """
    sections = build_document_tree()
    query_terms = set(_tokens(query))
    if not sections or not query_terms:
        return []

    # Document frequency over sections -> IDF.
    section_tokens = [set(_tokens(section["text"] + " " + section["heading_path"]))
                      for section in sections]
    total = len(sections)
    idf = {
        term: math.log(1 + total / (1 + sum(1 for tokens in section_tokens if term in tokens)))
        for term in query_terms
    }
    max_possible = sum(idf.values()) * 2 or 1.0

    scored: list[tuple[float, dict]] = []
    for section, tokens in zip(sections, section_tokens):
        heading_tokens = set(_tokens(section["heading_path"]))
        score = 0.0
        for term in query_terms:
            if term in heading_tokens:
                score += idf[term] * 2.0
            elif term in tokens:
                score += idf[term]
        if score > 0:
            scored.append((score / max_possible, section))

    scored.sort(key=lambda pair: pair[0], reverse=True)

    # The fees guide is bilingual, so the same heading path can occur twice
    # (English block + Vietnamese block). Keep the best-scoring occurrence only.
    seen: set[tuple[str, str]] = set()
    deduped: list[tuple[float, dict]] = []
    for score, section in scored:
        key = (section["doc"], section["heading_path"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append((score, section))
    scored = deduped

    results: list[dict] = []
    for rank, (score, section) in enumerate(scored[:top_k], start=1):
        results.append(
            {
                "content": f"## {section['heading_path']}\n\n{section['text']}",
                "score": round(float(score), 4),
                "metadata": {
                    "source": section["doc"],
                    "type": section["doc_type"],
                    "section": section["heading_path"],
                    "title": section["title"],
                    "engine": "local-structural",
                    "rank": rank,
                },
                "source": "pageindex",
            }
        )
    return results


# =============================================================================
# MARKDOWN -> PDF (PageIndex ingests PDFs, not .md)
# =============================================================================

_FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("C:/Windows/Fonts/segoeui.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/Library/Fonts/Arial Unicode.ttf"),
]


def markdown_to_pdf(md_path: Path, output_dir: Path = PDF_CACHE_DIR) -> Path:
    """
    Minimal markdown -> PDF so PageIndex can ingest our corpus. Headings are
    emitted in bold at a larger size so PageIndex's structure parser can still
    see the document outline.
    """
    from fpdf import FPDF

    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = output_dir / f"{md_path.stem}.pdf"
    if pdf_path.exists() and pdf_path.stat().st_mtime >= md_path.stat().st_mtime:
        return pdf_path

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    unicode_font = next((path for path in _FONT_CANDIDATES if path.exists()), None)
    if unicode_font:
        pdf.add_font("body", "", str(unicode_font))
        font_name, encode = "body", (lambda s: s)
    else:
        # Core fonts are latin-1 only; drop what cannot be encoded rather than crash.
        font_name = "Helvetica"
        encode = lambda s: s.encode("latin-1", "replace").decode("latin-1")

    for line in md_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            pdf.ln(3)
            continue
        heading = _HEADING_PATTERN.match(stripped)
        if heading:
            size = max(11, 18 - 2 * len(heading.group(1)))
            pdf.set_font(font_name, size=size)
            pdf.multi_cell(0, size * 0.55, encode(heading.group(2)))
            pdf.ln(2)
        else:
            pdf.set_font(font_name, size=10)
            pdf.multi_cell(0, 5, encode(stripped))

    pdf.output(str(pdf_path))
    return pdf_path


# =============================================================================
# PAGEINDEX API ENGINE
# =============================================================================

def _client():
    from pageindex.client import PageIndexClient

    return PageIndexClient(api_key=PAGEINDEX_API_KEY)


def _load_doc_ids() -> dict[str, str]:
    if DOC_ID_CACHE.exists():
        return json.loads(DOC_ID_CACHE.read_text(encoding="utf-8"))
    return {}


def _save_doc_ids(doc_ids: dict[str, str]) -> None:
    DOC_ID_CACHE.write_text(json.dumps(doc_ids, indent=2), encoding="utf-8")


def upload_documents(force: bool = False) -> dict[str, str]:
    """
    Convert every standardized markdown to PDF and submit it to PageIndex.
    Doc ids are cached in pageindex_doc_ids.json so re-runs are free.
    """
    if not has_api_key():
        raise RuntimeError(
            "PAGEINDEX_API_KEY is not set in .env — nothing to upload. "
            "The local structural engine is used instead at query time."
        )

    client = _client()
    doc_ids = {} if force else _load_doc_ids()

    for md_file in sorted(STANDARDIZED_DIR.rglob("*.md")):
        if md_file.name in doc_ids and not force:
            print(f"  = cached: {md_file.name} -> {doc_ids[md_file.name]}")
            continue
        pdf_path = markdown_to_pdf(md_file)
        response = client.submit_document(str(pdf_path))
        doc_id = response.get("doc_id") or response.get("id")
        if not doc_id:
            print(f"  ✗ no doc_id returned for {md_file.name}: {response}")
            continue
        doc_ids[md_file.name] = doc_id
        print(f"  ✓ uploaded: {md_file.name} -> {doc_id}")

    _save_doc_ids(doc_ids)
    print(f"\n{len(doc_ids)} documents registered in {DOC_ID_CACHE.name}")
    return doc_ids


def _poll_retrieval(client, retrieval_id: str) -> dict:
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        retrieval = client.get_retrieval(retrieval_id)
        status = (retrieval.get("status") or "").lower()
        if status in {"completed", "success", "done"}:
            return retrieval
        if status in {"failed", "error"}:
            raise RuntimeError(f"PageIndex retrieval failed: {retrieval}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"PageIndex retrieval {retrieval_id} timed out")


def _parse_retrieved_nodes(retrieval: dict, doc_name: str, top_k: int) -> list[dict]:
    """
    Defensive parser for retrieved_nodes[].relevant_contents[][].
    PageIndex returns no numeric relevance, so we synthesise a rank-decayed
    score — it is used for display only; Task 9 thresholds on dense cosine.
    """
    results: list[dict] = []
    for node_rank, node in enumerate(retrieval.get("retrieved_nodes", []), start=1):
        groups = node.get("relevant_contents") or []
        # relevant_contents is list[list[dict]] but has been seen as list[dict].
        flat = []
        for group in groups:
            flat.extend(group if isinstance(group, list) else [group])
        for item in flat:
            if not isinstance(item, dict):
                continue
            content = (item.get("relevant_content") or item.get("content") or "").strip()
            if not content:
                continue
            results.append(
                {
                    "content": content,
                    "score": round(1.0 / node_rank, 4),
                    "metadata": {
                        "source": doc_name,
                        "section": item.get("section_title") or node.get("title") or "",
                        "node_id": node.get("node_id") or node.get("id") or "",
                        "engine": "pageindex-api",
                    },
                    "source": "pageindex",
                }
            )
            if len(results) >= top_k:
                return results
    return results


def pageindex_api_search(query: str, top_k: int = 5, raw: bool = False) -> list[dict]:
    """Query every uploaded document and merge the retrieved sections."""
    doc_ids = _load_doc_ids()
    if not doc_ids:
        doc_ids = upload_documents()

    client = _client()
    merged: list[dict] = []
    for doc_name, doc_id in doc_ids.items():
        try:
            submitted = client.submit_query(doc_id=doc_id, query=query)
            retrieval_id = submitted.get("retrieval_id") or submitted.get("id")
            retrieval = _poll_retrieval(client, retrieval_id)
            if raw:
                print(json.dumps(retrieval, indent=2)[:4000])
            merged.extend(_parse_retrieved_nodes(retrieval, doc_name, top_k))
        except Exception as error:
            print(f"  ⚠ PageIndex query failed for {doc_name}: {error}")
        if len(merged) >= top_k * 2:
            break

    merged.sort(key=lambda item: item["score"], reverse=True)
    return merged[:top_k]


# =============================================================================
# PUBLIC INTERFACE (what Task 9 calls)
# =============================================================================

def pageindex_search(query: str, top_k: int = 5, engine: str = "auto") -> list[dict]:
    """
    Vectorless retrieval, used as the fallback when dense search is unconvincing.

    Args:
        query: The user question.
        top_k: Maximum number of sections to return.
        engine: "auto" (API if a key exists, else local), "pageindex", or "local".

    Returns:
        List of {'content', 'score', 'metadata', 'source': 'pageindex'}.
        Always a list — never raises — so the fallback path cannot break Task 9.
    """
    if not query or not query.strip():
        return []

    use_api = engine == "pageindex" or (engine == "auto" and has_api_key())
    if use_api:
        try:
            results = pageindex_api_search(query, top_k=top_k)
            if results:
                return results
            print("  ⚠ PageIndex API returned nothing — using the local structural engine.")
        except Exception as error:
            print(f"  ⚠ PageIndex API unavailable ({error}) — using the local structural engine.")

    return local_structural_search(query, top_k=top_k)


# =============================================================================
# CLI
# =============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vectorless retrieval (PageIndex)")
    parser.add_argument("-q", "--query", default="tuition fee payment methods")
    parser.add_argument("-k", "--top-k", type=int, default=3)
    parser.add_argument("--engine", choices=["auto", "pageindex", "local"], default="auto")
    parser.add_argument("--upload", action="store_true", help="upload the corpus to PageIndex")
    parser.add_argument("--tree", action="store_true", help="print the parsed section tree")
    args = parser.parse_args()

    print(f"PAGEINDEX_API_KEY: {'set' if has_api_key() else 'NOT set (local engine)'}")

    if args.tree:
        for section in build_document_tree():
            print(f"  [{section['doc']}] {section['heading_path']}  ({len(section['text'])} chars)")
        raise SystemExit(0)

    if args.upload:
        upload_documents()

    print(f"\nQuery: {args.query}")
    print("-" * 70)
    for i, hit in enumerate(pageindex_search(args.query, args.top_k, args.engine), 1):
        meta = hit["metadata"]
        print(f"  {i}. [{hit['score']:.4f}] ({meta.get('engine')}) {meta.get('source')} | {meta.get('section')}")
        print(f"     {hit['content'][:180].replace(chr(10), ' ')}...")
