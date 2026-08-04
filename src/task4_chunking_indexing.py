"""
Task 4 — Chunking & Indexing vào Vector Store.   [Role 3]

Pipeline: data/standardized/**.md  ->  chunks  ->  bge-m3 vectors  ->  ChromaDB

Run:
    python -m src.task4_chunking_indexing            # incremental (upsert)
    python -m src.task4_chunking_indexing --reset    # wipe collection, reindex
    python -m src.task4_chunking_indexing --dry-run  # chunk stats only, no API calls

-----------------------------------------------------------------------------
DESIGN DECISIONS (these are the ones to defend at the checkpoint)
-----------------------------------------------------------------------------

1. Chunking strategy = MarkdownHeaderTextSplitter  ->  RecursiveCharacterTextSplitter
   Neither one alone is good enough for this corpus:
     - MarkdownHeaderTextSplitter alone keeps the "## Tuition fees" heading as
       metadata (great for citations) but a single section of the fees guide is
       6k+ characters — far too big for one chunk.
     - RecursiveCharacterTextSplitter alone respects the size budget but throws
       away which section the text came from, so citations degrade to "some page
       of student-fees-guide.pdf".
   Running them in sequence gives both: header-aware sections, then hard-capped
   sub-chunks that inherit the section title. Every chunk therefore carries
   `source` + `section`, which is exactly what Task 10 needs to cite.

2. CHUNK_SIZE = 800, CHUNK_OVERLAP = 100  (as specified in LAB_GUIDE §4)
   - 800 chars ~ 200-250 tokens: one policy clause or one news paragraph.
     Small enough that a retrieved chunk is mostly signal (good for RAGAS
     context_precision), big enough to keep a fee table row with its header row
     (good for faithfulness).
   - 100 chars (12.5%) of overlap: the standard 10-15% rule. It stops a sentence
     that straddles a boundary — e.g. "...must be paid within 14 | days of the
     invoice date" — from being unanswerable in both chunks.

3. Embedding model = BAAI/bge-m3 via OpenRouter (1024-dim)
   Multilingual: the corpus is English, the chatbot UI asks in Vietnamese.
   bge-m3 puts both in the same vector space, so "Học phí bao nhiêu?" retrieves
   the English "Tuition fees" chunk. See src/embedding_client.py for details.

4. Vector store = ChromaDB, `hnsw:space = cosine`
   Local, persistent, zero Docker. Cosine (not L2) because our vectors are
   L2-normalised, which makes `score = 1 - distance` a true cosine similarity in
   [0, 1] — Task 9 compares that number directly against SCORE_THRESHOLD.

⚠ If the corpus changes (new/removed documents), run with --reset. Otherwise old
  chunks stay in the collection and retrieval returns ghosts from the old corpus.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import threading
from pathlib import Path

from .embedding_client import EMBEDDING_DIM as _EMBEDDING_DIM
from .embedding_client import EMBEDDING_MODEL as _EMBEDDING_MODEL
from .embedding_client import embed_texts

STANDARDIZED_DIR = Path(__file__).parent.parent / "data" / "standardized"
CHROMA_DIR = Path(__file__).parent.parent / "chroma_db"


# =============================================================================
# CONFIGURATION
# =============================================================================

CHUNK_SIZE = 800        # See design note 2 above.
CHUNK_OVERLAP = 100     # 12.5% of CHUNK_SIZE.
CHUNKING_METHOD = "markdown_header+recursive"

EMBEDDING_MODEL = _EMBEDDING_MODEL   # "baai/bge-m3"
EMBEDDING_DIM = _EMBEDDING_DIM       # 1024

VECTOR_STORE = "chromadb"
COLLECTION_NAME = "university_services_docs"

# Markdown headers we split on, and the metadata key each level maps to.
HEADERS_TO_SPLIT_ON = [("#", "h1"), ("##", "h2"), ("###", "h3")]

# Chunks shorter than this are almost always leftovers ("---", a stray heading,
# a page number from the PDF conversion). They pollute BM25 and waste context.
MIN_CHUNK_CHARS = 80


# =============================================================================
# HEADING RECOVERY
# =============================================================================
# The legal PDFs come out of MarkItDown (Task 3) with ZERO markdown headings —
# `grep -c '^#' student-fees-and-charges-guide-rmit-2026.md` returns 0. Their
# structure is encoded as numbered clauses instead: "4.2 Family Tuition fee
# assistance program". Without this step MarkdownHeaderTextSplitter finds nothing
# in the most important documents in the corpus, every legal chunk gets the same
# section label, and citations degrade to "somewhere in the 59-page fees guide".
#
# So we promote numbered clause titles to real markdown headings first:
#     "4.2 Family Tuition fee assistance program"  ->  "### 4.2 Family Tuition..."
# Depth of the number decides the heading level, which rebuilds the real
# hierarchy (4 > 4.2 > 4.2.1) that both Task 4 and Task 8 then navigate.

_NUMBERED_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.?[ \t]+(\S.*?)[ \t]*$")
_TOC_LEADER = re.compile(r"\.{5,}")            # "1. Foreword ......... 6" -> contents page
_PAGE_FOOTER = re.compile(r"\bPage\s+\d+\s+of\s+\d+\b", re.IGNORECASE)
MAX_HEADING_CHARS = 80
MAX_CLAUSE_NUMBER = 99                          # "702 Nguyen Van Linh" is an address
MAX_BOILERPLATE_REPEATS = 3                     # running headers/footers repeat


def clean_markdown(text: str) -> str:
    """
    Drop the two kinds of PDF furniture MarkItDown leaves behind. Both are pure
    retrieval noise: they match query keywords ("7. Payment Methods .... 24")
    while carrying no answer, so they steal top-k slots from real content.

      * table-of-contents lines  -> "7. Payment Methods ................ 24"
      * running page footers     -> "17 June 2026 ... Page 7 of 59"
    """
    kept = [
        line
        for line in text.splitlines()
        if not _TOC_LEADER.search(line) and not _PAGE_FOOTER.search(line)
    ]
    # Collapse the blank runs the removals leave behind.
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept))


def _looks_like_heading(number: str, title: str) -> bool:
    return (
        len(title) <= MAX_HEADING_CHARS             # a heading, not a paragraph
        and title[0].isalpha()                      # skip "1. 250,000 VND"
        and not title.endswith((".", ",", ";", ":"))
        and ". " not in title                       # skip multi-sentence body text
        and not _PAGE_FOOTER.search(title)          # "...Page 7 of 59"
        and int(number.split(".")[0]) <= MAX_CLAUSE_NUMBER
    )


def promote_numbered_headings(text: str) -> str:
    """
    Rewrite numbered clause titles as markdown headings. Idempotent.

    Two passes: the first collects candidates so we can drop running
    headers/footers (a "heading" that appears more than a few times in the same
    document is page furniture, not structure).
    """
    lines = text.splitlines()
    candidates: list[tuple[int, str, str]] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if _TOC_LEADER.search(stripped):
            continue
        match = _NUMBERED_HEADING.match(stripped)
        if match and _looks_like_heading(match.group(1), match.group(2)):
            candidates.append((index, match.group(1), match.group(2)))

    repeats: dict[str, int] = {}
    for _, _, title in candidates:
        key = title.lower()
        repeats[key] = repeats.get(key, 0) + 1

    output = list(lines)
    for index, number, title in candidates:
        if repeats[title.lower()] > MAX_BOILERPLATE_REPEATS:
            continue
        level = min(len(number.split(".")) + 1, 4)
        output[index] = f"{'#' * level} {number} {title}"
    return "\n".join(output)


# =============================================================================
# LOAD
# =============================================================================

def load_documents() -> list[dict]:
    """
    Read every markdown file under data/standardized/.

    Returns:
        List of {'content': str, 'metadata': {'source', 'type', 'title'}}
    """
    documents: list[dict] = []
    if not STANDARDIZED_DIR.exists():
        return documents

    for md_file in sorted(STANDARDIZED_DIR.rglob("*.md")):
        content = md_file.read_text(encoding="utf-8").strip()
        if not content:
            continue
        content = promote_numbered_headings(clean_markdown(content))

        # data/standardized/legal/x.md -> "legal";  .../news/y.md -> "news"
        doc_type = md_file.parent.name if md_file.parent != STANDARDIZED_DIR else "other"

        # First H1 is the human-readable title; fall back to the filename.
        title_match = re.search(r"^#\s+(.+)$", content, flags=re.MULTILINE)
        title = title_match.group(1).strip() if title_match else md_file.stem

        documents.append(
            {
                "content": content,
                "metadata": {
                    "source": md_file.name,
                    "type": doc_type,
                    "title": title[:200],
                },
            }
        )
    return documents


# =============================================================================
# CHUNK
# =============================================================================

class _PlainSection:
    """Stand-in for a LangChain Document when a file has no markdown headings."""

    def __init__(self, page_content: str):
        self.page_content = page_content
        self.metadata: dict = {}


def _build_splitters():
    from langchain_text_splitters import (
        MarkdownHeaderTextSplitter,
        RecursiveCharacterTextSplitter,
    )

    header_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=HEADERS_TO_SPLIT_ON,
        strip_headers=False,   # keep heading text inside the chunk -> helps BM25
    )
    character_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        # Ordered from "most semantic" to "last resort". The final "" guarantees
        # a hard cut, so no chunk can ever exceed CHUNK_SIZE.
        separators=["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""],
        length_function=len,
    )
    return header_splitter, character_splitter


def _heading_parts(header_metadata: dict) -> list[str]:
    return [header_metadata.get(key) for _, key in HEADERS_TO_SPLIT_ON if header_metadata.get(key)]


def _section_label(header_metadata: dict) -> str:
    """
    The deepest heading — "7.2 Online Payment" — which is what a citation should
    point at. The full ancestry is kept separately in `section_path`; we do not
    use it as the label because heading recovery occasionally promotes a numbered
    list item, and one bad ancestor would poison every citation beneath it.
    """
    parts = _heading_parts(header_metadata)
    return (parts[-1] if parts else "")[:200]


def _section_path(header_metadata: dict) -> str:
    """Full ancestry, e.g. '7 Payment Methods > 7.2 Online Payment'."""
    return " > ".join(_heading_parts(header_metadata))[:300]


def chunk_documents(documents: list[dict]) -> list[dict]:
    """
    Two-stage chunking: markdown headers first, then a hard character cap.

    Returns:
        List of {'content': str, 'metadata': dict} — one item per chunk.
    """
    header_splitter, character_splitter = _build_splitters()
    chunks: list[dict] = []

    for doc in documents:
        try:
            sections = header_splitter.split_text(doc["content"])
        except Exception:
            sections = []
        if not sections:
            # No headings at all -> treat the whole file as a single section.
            sections = [_PlainSection(doc["content"])]

        chunk_index = 0
        for section in sections:
            section_text = (getattr(section, "page_content", "") or "").strip()
            if not section_text:
                continue
            section_meta = getattr(section, "metadata", {}) or {}
            section_name = _section_label(section_meta) or doc["metadata"]["title"]
            section_path = _section_path(section_meta) or doc["metadata"]["title"]

            for piece in character_splitter.split_text(section_text):
                piece = piece.strip()
                if len(piece) < MIN_CHUNK_CHARS:
                    continue
                chunks.append(
                    {
                        "content": piece,
                        "metadata": {
                            **doc["metadata"],
                            "section": section_name,
                            "section_path": section_path,
                            "chunk_index": chunk_index,
                            "char_len": len(piece),
                        },
                    }
                )
                chunk_index += 1

    return chunks


# =============================================================================
# EMBED
# =============================================================================

def embed_chunks(chunks: list[dict]) -> list[dict]:
    """
    Embed every chunk with bge-m3. Adds `embedding: list[float]` to each chunk.
    Vectors are cached on disk, so re-running this is nearly free.
    """
    if not chunks:
        return chunks

    texts = [chunk["content"] for chunk in chunks]
    vectors = embed_texts(texts, show_progress=True)
    for chunk, vector in zip(chunks, vectors):
        chunk["embedding"] = vector
    return chunks


def get_embedding_model():
    """
    Compatibility shim so callers can use the familiar `.encode()` interface
    (the sentence-transformers API) while we actually call OpenRouter.
    """

    class _OpenRouterEncoder:
        model_name = EMBEDDING_MODEL
        dimension = EMBEDDING_DIM

        @staticmethod
        def encode(texts, **_kwargs):
            if isinstance(texts, str):
                return embed_texts([texts])[0]
            return embed_texts(list(texts))

    return _OpenRouterEncoder()


# =============================================================================
# INDEX
# =============================================================================

_chroma_client = None
_chroma_client_lock = threading.Lock()

def get_client():
    global _chroma_client
    import chromadb

    if _chroma_client is None:
        with _chroma_client_lock:
            if _chroma_client is None:
                CHROMA_DIR.mkdir(parents=True, exist_ok=True)
                _chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return _chroma_client


def get_collection(create: bool = True):
    """
    Return the Chroma collection. `embedding_function=None` matters: we always
    pass vectors in ourselves, and leaving it unset makes Chroma try to download
    its default ONNX MiniLM model.
    """
    client = get_client()
    try:
        if create:
            return client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
                embedding_function=None,
            )
        return client.get_collection(name=COLLECTION_NAME, embedding_function=None)
    except TypeError:
        # chromadb versions whose signature rejects embedding_function=None.
        if create:
            return client.get_or_create_collection(
                name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"}
            )
        return client.get_collection(name=COLLECTION_NAME)


def reset_collection() -> None:
    """Delete the whole persisted store — the safe way to reindex a new corpus."""
    global _chroma_client
    _chroma_client = None
    if CHROMA_DIR.exists():
        shutil.rmtree(CHROMA_DIR)
        print(f"  ✓ Removed {CHROMA_DIR}")


def index_to_vectorstore(chunks: list[dict]) -> int:
    """Upsert chunks (+ vectors + metadata) into ChromaDB. Returns rows written."""
    if not chunks:
        return 0

    collection = get_collection()
    ids = [
        f"{chunk['metadata']['source']}::{chunk['metadata']['chunk_index']}"
        for chunk in chunks
    ]

    # Chroma metadata values must be str/int/float/bool — no None, no lists.
    metadatas = [
        {
            key: (value if isinstance(value, (str, int, float, bool)) else str(value))
            for key, value in chunk["metadata"].items()
            if value is not None
        }
        for chunk in chunks
    ]

    batch = 200
    for start in range(0, len(chunks), batch):
        window = slice(start, start + batch)
        collection.upsert(
            ids=ids[window],
            documents=[chunk["content"] for chunk in chunks[window]],
            embeddings=[chunk["embedding"] for chunk in chunks[window]],
            metadatas=metadatas[window],
        )
    return len(chunks)


# =============================================================================
# PIPELINE
# =============================================================================

def _print_stats(chunks: list[dict]) -> None:
    if not chunks:
        return
    lengths = [len(chunk["content"]) for chunk in chunks]
    by_type: dict[str, int] = {}
    for chunk in chunks:
        key = chunk["metadata"]["type"]
        by_type[key] = by_type.get(key, 0) + 1
    print(
        f"  chunk chars: min={min(lengths)} avg={sum(lengths) // len(lengths)} "
        f"max={max(lengths)} (limit {CHUNK_SIZE})"
    )
    print(f"  by doc type: {by_type}")


def run_pipeline(reset: bool = False, dry_run: bool = False):
    """load → chunk → embed → index."""
    print("=" * 60)
    print("Task 4: Chunking & Indexing")
    print(f"  Chunking     : {CHUNKING_METHOD} (size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})")
    print(f"  Embedding    : {EMBEDDING_MODEL} (dim={EMBEDDING_DIM}, via OpenRouter)")
    print(f"  Vector store : {VECTOR_STORE} -> {CHROMA_DIR.name}/  [{COLLECTION_NAME}]")
    print("=" * 60)

    if reset and not dry_run:
        print("\n--reset: clearing the existing vector store")
        reset_collection()

    docs = load_documents()
    print(f"\n✓ Loaded {len(docs)} documents from {STANDARDIZED_DIR}")
    if not docs:
        print("  ✗ Nothing to index. Run Task 3 first: python -m src.task3_convert_markdown")
        return

    chunks = chunk_documents(docs)
    print(f"✓ Created {len(chunks)} chunks")
    _print_stats(chunks)

    if dry_run:
        print("\n--dry-run: stopping before the embedding API calls.")
        for chunk in chunks[:3]:
            meta = chunk["metadata"]
            print(f"\n  [{meta['source']} | {meta['section']}]")
            print(f"  {chunk['content'][:200]}...")
        return

    chunks = embed_chunks(chunks)
    print(f"✓ Embedded {len(chunks)} chunks")

    written = index_to_vectorstore(chunks)
    total = get_collection().count()
    print(f"✓ Indexed {written} chunks — collection now holds {total} vectors")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chunk + embed + index the corpus")
    parser.add_argument("--reset", action="store_true", help="delete chroma_db/ first")
    parser.add_argument("--dry-run", action="store_true", help="no embedding API calls")
    args = parser.parse_args()
    try:
        run_pipeline(reset=args.reset, dry_run=args.dry_run)
    except KeyboardInterrupt:
        sys.exit(130)
