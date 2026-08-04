# Role 3 + Role 4 — Retrieval Core Implementation

**Owner:** Vinh
**Scope:** Task 4 (Chunking & Indexing), Task 5 (Semantic Search & HyDE), Task 6 (BM25 / TF-IDF), Task 7 (RRF Reranking), Task 8 (Vectorless Fallback)
**Status:** all five tasks implemented; `pytest tests/test_individual.py` → **28 passed** (the 7 skips are Task 9 and Task 10, owned by Role 2 and Role 5)

---

## 1. What was already in the repo, and what was missing

| Task | Before | After |
| :-- | :-- | :-- |
| 1–3 (Role 2) | done — 3 legal PDFs, 5 news JSON, 8 markdown files in `data/standardized/` | untouched |
| **4** | `NotImplementedError` in all four functions | implemented + heading recovery + corpus cleaning |
| **5** | `NotImplementedError` | implemented + HyDE + threshold calibration tool |
| **6** | `NotImplementedError` | implemented, BM25 **and** TF-IDF |
| **7** | `NotImplementedError` | RRF, MMR and cross-encoder all implemented |
| **8** | `NotImplementedError` | PageIndex API path + offline structural engine |
| 9–10 | `NotImplementedError` | still open — not our roles |

One new shared module was added: **`src/embedding_client.py`**.

---

## 2. A problem we found in the corpus before writing any retrieval code

The first thing we did was look at what Task 3 actually produced, not what it was supposed to produce:

```
$ grep -c '^#' data/standardized/legal/student-fees-and-charges-guide-rmit-2026.md
0
```

**The three legal PDFs have zero markdown headings.** MarkItDown converted a 59-page PDF into a flat wall of text. Two consequences, both fatal if ignored:

1. `MarkdownHeaderTextSplitter` would find nothing, so every one of the ~276 legal chunks would carry the same section label — citations in Task 10 would say "somewhere in the fees guide" instead of "§7.2 Online Payment".
2. Task 8's whole premise is navigating document *structure*. With no headings there is no structure to navigate, and the vectorless engine would be one blob per document.

The structure is there, it is just encoded as **numbered clauses** rather than markdown:

```
7 Payment Methods
7.2 Online Payment
9.4 Payment Deadlines
```

So `src/task4_chunking_indexing.py` gained two preprocessing steps that both Task 4 and Task 8 use:

**`clean_markdown()`** removes PDF furniture that is pure retrieval noise:
- table-of-contents lines (`7. Payment Methods ................. 24`)
- running page footers (`17 June 2026 ... Page 7 of 59`)

These lines match query keywords perfectly while containing zero answers, so before the cleanup they were stealing top-k slots. Removing them dropped the chunk count from 407 to **364** and pushed real content into the top 3 for "payment methods".

**`promote_numbered_headings()`** rewrites `7.2 Online Payment` as `### 7.2 Online Payment`, with heading depth taken from the number depth (`7` → `##`, `7.2` → `###`, `7.2.1` → `####`). Three guards stop false positives, each one found by actually reading the output:

| Guard | Rejects |
| :-- | :-- |
| leading number ≤ 99 | `702 Nguyen Van Linh, Tan Phong Ward` (a street address) |
| title ≤ 80 chars, no `". "` inside, no trailing punctuation | body sentences that happen to start with a digit |
| a title repeated > 3 times in one document | running headers and footers |

Result: 115 recovered headings in the fees guide, 20 in the scholarship T&C. The Task 8 section tree went from **55 → 154 sections**, and legal documents finally have navigable structure.

> This is worth mentioning in the demo. It is not in the lab brief, and it is the difference between citations that name a clause and citations that name a file.

---

## 3. Task 4 — Chunking & Indexing

`src/task4_chunking_indexing.py`

### Chunking: two splitters in sequence

```
markdown  →  MarkdownHeaderTextSplitter  →  RecursiveCharacterTextSplitter  →  chunks
             (keeps section identity)        (enforces the size budget)
```

Neither alone is sufficient. Header splitting keeps `section` metadata but produces 6k-character sections; character splitting caps the size but discards where the text came from. Chaining them gives chunks that are both bounded **and** labelled — every chunk carries `source`, `type`, `section`, `section_path`, `chunk_index`, `char_len`.

`section` is the **deepest** heading (`7.2 Online Payment`), not the full path. Heading recovery occasionally promotes a numbered list item, and if we used the full ancestry a single bad ancestor would poison every citation beneath it. The full path is kept separately in `section_path`.

### Parameters

| Parameter | Value | Reasoning |
| :-- | :-- | :-- |
| `CHUNK_SIZE` | 800 | ≈200–250 tokens — one policy clause or one news paragraph. Small enough that a retrieved chunk is mostly signal (RAGAS `context_precision`), large enough to keep a fee table row with its header row (`faithfulness`). |
| `CHUNK_OVERLAP` | 100 | 12.5%, the standard 10–15% rule. Stops a sentence split across a boundary from being unanswerable in both halves. |
| `MIN_CHUNK_CHARS` | 80 | Drops `---`, orphan headings, page numbers. They pollute BM25's IDF statistics. |

Measured output: **364 chunks** (276 legal / 88 news), min 82 chars, avg 553, max 800 — the cap is never exceeded, which is what `TestTask4.test_chunks_respect_size_limit` checks.

### Embedding: `baai/bge-m3` through OpenRouter

Implemented in `src/embedding_client.py`, and it is deliberately the **only** place in the repo that produces a vector. Using a different model at index time and query time is a silent, hard-to-debug quality killer, so there is exactly one code path.

- **Why bge-m3:** 1024-dim, multilingual, 8192-token context. The corpus is bilingual — the fee guide interleaves English and Vietnamese (`### 7.2 Online Payment / Thanh toán trực tuyến`) — and the Streamlit UI asks questions in Vietnamese. bge-m3 puts both languages in one vector space, so *"Học phí đóng thế nào?"* retrieves the English clause.
- **Why symmetric (no prefix):** unlike bge-v1.5, bge-m3 needs no `"Represent this sentence for searching relevant passages:"` instruction. Adding one would *hurt*, because the same string was never prepended at index time.
- **Why hosted rather than local:** the weights are ~2.2 GB. An API call keeps the repo light and guarantees every team member gets byte-identical vectors.
- **Cost control:** every vector is cached in `.cache/embeddings.sqlite3`, keyed by `sha256(model + text)`. Re-running the indexer after a corpus tweak re-embeds only what changed — our last run reported `Embedding 103 new / 364 total (261 from cache)`. Requests are batched 32 at a time with exponential backoff on 429/5xx.
- **L2 normalisation:** vectors are normalised before storage. That is what makes `1 - cosine_distance` a genuine cosine similarity in `[0, 1]`, which Task 9 can threshold against a human-readable number.

### Vector store: ChromaDB, cosine space

`PersistentClient` at `chroma_db/`, collection `university_services_docs`, `metadata={"hnsw:space": "cosine"}`, `embedding_function=None`.

That last argument matters: leaving it unset makes Chroma download its own default ONNX MiniLM model and, worse, quietly re-embed anything you insert without vectors.

Ids are `{source}::{chunk_index}` and writes use `upsert`, so re-running is idempotent. **If the corpus changes, run with `--reset`** — otherwise chunks from the old corpus stay in the collection and retrieval returns ghosts (troubleshooting item #6 in the lab guide).

---

## 4. Task 5 — Semantic Search + HyDE

`src/task5_semantic_search.py`

### Scoring stays on the raw cosine scale

```python
score = max(0.0, min(1.0, 1.0 - distance))
```

We deliberately do **not** min-max rescale per query. Task 9 compares this exact number against `SCORE_THRESHOLD` to decide whether to fall back to PageIndex; rescaling would make every query's top-1 score ≈ 1.0 and the threshold meaningless.

### HyDE is opt-in, not always-on

HyDE (Gao et al., 2022) asks an LLM for a *hypothetical answer* and searches with that instead of the question — it closes the register gap between how students ask ("Bao giờ phải đóng tiền?") and how policies are written ("Payment is due 14 days before census date").

Trade-offs that led to `use_hyde=False` by default:

- it adds one LLM round-trip of latency to every query;
- the hypothetical answer can hallucinate the query *away* from the corpus;
- OpenRouter `:free` models are limited to ~50 requests/day for the whole account, and the RAGAS run in Checkpoint 5 needs that budget.

When enabled, we search with **both** the original query and the hypothetical document, then keep the **max** cosine per chunk rather than fusing ranks. Taking the max keeps the output on the cosine scale, so the Task 9 fallback threshold still works with HyDE on. If the LLM call fails for any reason, it degrades silently to plain dense search.

### Threshold calibration tool

`python -m src.task5_semantic_search --calibrate` runs 6 in-domain questions and 5 deliberately out-of-domain ones, prints every top-1 cosine, and suggests a threshold midway between the lowest in-domain and the highest out-of-domain score.

This exists because of the trap the lab guide warns about: `SCORE_THRESHOLD` must be measured on *this* corpus with *this* embedding model, not copied from the starter template. **Hand the printed number to Role 2 for Task 9.**

---

## 5. Task 6 — Lexical Search (BM25 + TF-IDF)

`src/task6_lexical_search.py`

### The corpus is read back out of ChromaDB — this is the important part

```python
payload = collection.get(include=["documents", "metadatas"])
```

RRF fuses two ranked lists by matching identical documents. If BM25 re-chunked the markdown even slightly differently from Task 4, **no chunk would ever appear in both lists**, every fused score would be a lone `1/(60+rank)`, and hybrid search would silently degenerate into "concatenate dense and sparse results". Reading the chunks back out of the vector store makes both sides byte-identical by construction.

Verified in the sandbox — a chunk found by both retrievers correctly doubles its score and jumps to rank 1:

```
0.032787  {'dense': 0.3558, 'lexical': 11.6138}   7.2 Online Payment      ← found by both
0.016393  {'dense': 0.3585}                       9.4 Payment Deadlines   ← dense only
```

If `chroma_db/` does not exist yet, we fall back to calling Task 4's `chunk_documents()` directly — same code path, so still identical text.

### BM25 parameters

`BM25Okapi(k1=1.5, b=0.75)`:

- **k1 = 1.5** — term saturation. The 10th occurrence of "fee" in a chunk adds far less than the 2nd.
- **b = 0.75** — length normalisation. Our chunks are near-uniform in length by construction, so this is nearly a no-op here; that is a deliberate consequence of fixed-size chunking, and worth saying out loud if a coach asks.

### Tokenisation

`re.findall(r"\w+", text.lower())` with `re.UNICODE`, not `.split()`. Two reasons: `"fees."`, `"fees,"` and `"fees"` must collapse to one token or BM25 misses obvious matches; and `\w` with `re.UNICODE` keeps Vietnamese diacritics intact (`học` stays one token instead of being mangled). We do **not** run Vietnamese word segmentation — the corpus body text is largely English, so syllable-level tokens are the right granularity and a segmenter would only slow start-up.

### TF-IDF as a second ranker (bonus)

scikit-learn `TfidfVectorizer` with `ngram_range=(1,2)` (bigrams catch "census date", "tuition fee") and `sublinear_tf=True` (TF-IDF's poor-man's saturation), scored by cosine.

`python -m src.task6_lexical_search --compare` shows both side by side. The demo point: TF-IDF has no document-length term and weaker saturation, so it over-rewards long chunks that repeat a keyword; BM25 wins on short factual queries.

---

## 6. Task 7 — Reranking

`src/task7_reranking.py`

### RRF is the primary method

```
RRF(d) = Σ_r  1 / (k + rank_r(d)),  k = 60
```

Dense cosine lives in `[0, 1]`; BM25 is unbounded and corpus-dependent (we see values up to ~11). You cannot add or average them — a BM25 score of 11.6 is not "better" than a cosine of 0.36. RRF throws magnitudes away and fuses **ranks only**, which is exactly why it needs no calibration.

`k = 60` (Cormack et al., 2009) flattens the gap between rank 1 and rank 2 (1/61 vs 1/62), so a chunk *both* retrievers like beats a chunk only one retriever loves. That is the entire point of hybrid search.

### The trap, and how we defused it for Task 9

**RRF scores are not similarities.** With `k=60` the best possible fused score is ~0.0164 from one list and ~0.0328 from two — *regardless of relevance*. A nonsense query still produces a "top" result at 0.0328. Anyone who thresholds on the RRF score will find that fallback never triggers.

So every fused item carries its provenance:

```python
item["score"]            # fused RRF — for ordering only
item["rrf_score"]        # same value, explicitly named
item["retriever_scores"] # {'dense': 0.3558, 'lexical': 11.6138} — the originals
item["dense_score"]      # convenience copy for Task 9's threshold check
```

**Message for Role 2 (Task 9): threshold on `dense_results[0]["score"]` — the raw cosine from Task 5 — never on the fused score.**

### Dedupe key

`(metadata.source, metadata.chunk_index)`, falling back to the content string when metadata is absent (the unit tests pass metadata-less dummies). Content strings can differ by trailing whitespace between retrievers; a metadata id is stable.

### MMR and cross-encoder

Both implemented, neither on the default path.

- **MMR** (`λ = 0.7`): `λ·sim(query, doc) − (1−λ)·max sim(doc, selected)`. Useful when the top-5 are five near-duplicate paragraphs of the same fee table. Costs embedding calls at query time, so it is opt-in.
- **Cross-encoder** (Jina Reranker v2 multilingual): highest quality, needs `JINA_API_KEY` and another network hop. Without a key it degrades gracefully to the incoming order rather than raising.

`rerank(query, candidates, top_k, method)` accepts either a flat list (treated as one ranked list) or a list of ranked lists (fused), so both the unit tests and Task 9 can call the same function.

---

## 7. Task 8 — Vectorless Fallback

`src/task8_pageindex_vectorless.py`

### Why a fallback at all

Task 9 calls this when dense retrieval's top-1 cosine is below threshold — when the vector index has nothing convincing. Vectorless retrieval attacks the same corpus a *different* way: instead of comparing embeddings of fixed-size chunks, it walks the document outline (title → section → sub-section) the way a person flips to a chapter. It is therefore not affected by whatever made the embedding search fail — a rare acronym, an unusual phrasing, a number that embeddings smear away.

### Two engines behind one interface

```python
pageindex_search(query, top_k, engine="auto")
```

**`engine="pageindex"`** — the hosted API. Activates automatically as soon as `PAGEINDEX_API_KEY` is present in `.env`. Flow: markdown → PDF (PageIndex ingests PDFs, not `.md`) → `submit_document` → `submit_query` → poll `get_retrieval` until `status == "completed"`. Doc ids are cached in `pageindex_doc_ids.json` and generated PDFs in `pageindex_pdfs/` (both already gitignored).

The `/retrieval` endpoint is flagged deprecated and nests results as `retrieved_nodes[].relevant_contents[][]`, which the starter comments warn is easy to get wrong. Our parser is written defensively — it tolerates both `list[list[dict]]` and `list[dict]` — and `--raw` dumps the untouched JSON so you can re-check the schema rather than trusting an old code sample. PageIndex returns no numeric relevance, so we synthesise a rank-decayed score for display; Task 9 thresholds on dense cosine anyway.

**`engine="local"`** — an offline reimplementation of the same idea, used whenever there is no API key. It parses every markdown file into a heading tree (after the same `clean_markdown` + `promote_numbered_headings` preprocessing) and scores whole **sections** by IDF-weighted query-term coverage, with a **×2 boost for terms appearing in the heading path**. That boost is the "read the table of contents first" heuristic — a heading match is far stronger evidence than a body match.

Both engines return the same shape and both set `source: "pageindex"`, so Task 9 and the tests treat them interchangeably; `metadata["engine"]` records which one ran (`pageindex-api` or `local-structural`).

`pageindex_search()` **never raises** — every failure path returns a list. The fallback branch cannot be the thing that breaks the pipeline.

Sanity check, local engine, query "payment methods":

```
1. [1.0000] student-fees-and-charges-guide-rmit-2026.md | 7 Payment Methods
2. [0.2848] scholarship-terms-and-conditions-rmit.md    | 21 Payment of the stipend...
```

Out-of-domain query `xyzabc123nonsense` correctly returns `[]`.

> **`PAGEINDEX_API_KEY=` is left empty in `.env.example`.** Paste the key there when you get one and the API engine switches on with no code change; until then the local engine covers the fallback path.

---

## 8. Interface contract for Role 2 (Task 9) and Role 5 (Task 10)

Everything returns `list[dict]`, sorted by `score` descending, never `None`, never raising on an empty index.

```python
from src.task5_semantic_search import semantic_search        # cosine [0,1]
from src.task6_lexical_search  import lexical_search         # BM25 (unbounded)
from src.task7_reranking       import rerank_rrf, rerank
from src.task8_pageindex_vectorless import pageindex_search  # sets source='pageindex'

dense  = semantic_search(query, top_k=top_k * 2)             # optional use_hyde=True
sparse = lexical_search(query,  top_k=top_k * 2)             # optional method='tfidf'
merged = rerank_rrf([dense, sparse], top_k=top_k * 2)        # order matters: dense first

best_cosine = dense[0]["score"] if dense else 0.0            # ← threshold on THIS
if best_cosine < SCORE_THRESHOLD:
    fallback = pageindex_search(query, top_k=top_k)
    if fallback:
        return fallback                                      # already source='pageindex'

for item in merged:
    item["source"] = "hybrid"
return merged[:top_k]
```

Result shape:

```python
{
  "content": str,
  "score":   float,
  "metadata": {
      "source": "student-fees-and-charges-guide-rmit-2026.md",
      "type": "legal",                 # 'legal' | 'news'
      "title": "2026 STUDENT FEES & CHARGES GUIDE",
      "section": "7.2 Online Payment",          # ← cite this in Task 10
      "section_path": "7 Payment Methods > 7.2 Online Payment",
      "chunk_index": 128,
      "char_len": 742,
  },
  # present on RRF output only:
  "rrf_score": 0.032787,
  "retriever_scores": {"dense": 0.3558, "lexical": 11.6138},
  "dense_score": 0.3558,
}
```

Two things to hand over verbally:
1. the calibrated `SCORE_THRESHOLD` from `--calibrate` (Role 2 needs it);
2. `metadata["section"]` is the citation label — `[student-fees-guide, §7.2 Online Payment]` reads far better than a bare filename (Role 5 needs it).

---

## 9. Commands

Windows PowerShell. Run everything from the repo root, with the venv active.

```powershell
# --- one-time setup ----------------------------------------------------------
$env:PYTHONIOENCODING = "utf-8"        # avoids UnicodeEncodeError on cp1258 consoles
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

copy .env.example .env
notepad .env                            # paste OPENROUTER_API_KEY
```

```powershell
# --- Task 4: chunk + embed + index -------------------------------------------
python -m src.task4_chunking_indexing --dry-run     # chunk stats, zero API calls
python -m src.task4_chunking_indexing --reset       # full build (~364 vectors)
python -m src.embedding_client                      # cache stats + EN/VI sanity check
```

```powershell
# --- Task 5: semantic search --------------------------------------------------
python -m src.task5_semantic_search
python -m src.task5_semantic_search -q "How do I pay my tuition fees?" -k 5
python -m src.task5_semantic_search -q "Học phí đóng thế nào?" --hyde
python -m src.task5_semantic_search --calibrate     # → SCORE_THRESHOLD for Task 9
```

```powershell
# --- Task 6: lexical search ---------------------------------------------------
python -m src.task6_lexical_search -q "payment methods"
python -m src.task6_lexical_search -q "census date" --compare     # BM25 vs TF-IDF
```

```powershell
# --- Task 7: reranking --------------------------------------------------------
python -m src.task7_reranking -q "payment methods" -k 5           # RRF
python -m src.task7_reranking -q "scholarship" --method mmr
```

```powershell
# --- Task 8: vectorless fallback ---------------------------------------------
python -m src.task8_pageindex_vectorless --tree                   # section tree
python -m src.task8_pageindex_vectorless -q "payment methods" -k 3
python -m src.task8_pageindex_vectorless --upload                 # only with an API key
```

```powershell
# --- grading ------------------------------------------------------------------
pytest tests/test_individual.py -v
```

---

## 10. Test results

```
$ pytest tests/test_individual.py -q
............................sssssss                            [100%]
28 passed, 7 skipped
```

All of Task 1–8 passes. The 7 skips are `TestTask9` (5) and `TestTask10` (2), which are Role 2's and Role 5's work and still raise `NotImplementedError`.

Verification was run in a Linux sandbox with a deterministic stub embedder substituted for the OpenRouter call, so the pipeline logic — chunking, indexing, retrieval, fusion, dedupe, fallback — was exercised end to end without spending API quota. The stub is a bag-of-words hash into 1024 dimensions; absolute cosine values from that run are meaningless, which is exactly why `--calibrate` must be re-run against the real embedding model before Role 2 fixes `SCORE_THRESHOLD`.

---

## 11. Known limitations

- `accommodation-advice-international-students-rmit.md` has neither markdown headings nor numbered clauses, so it stays a single section for the vectorless engine. Its chunks are still fully indexed and searchable through Tasks 5–7.
- Heading recovery occasionally promotes a numbered list item in the scholarship T&C (the clauses genuinely are numbered sentences). Harmless — it makes the section label verbose, not wrong — and it is why `section` uses the deepest heading rather than the full ancestry.
- HyDE and the cross-encoder both cost an extra network round-trip per query; leave them off during the RAGAS run to protect the OpenRouter free-tier quota.
- `SCORE_THRESHOLD` in Task 9 is still the starter's placeholder. It must be replaced with the `--calibrate` output measured against real bge-m3 vectors.
