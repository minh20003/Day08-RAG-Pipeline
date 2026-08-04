import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  FileSearch,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react";
import type { BackendStatus, DocumentCategory, SourceDocument } from "../types";
import { CountUpValue } from "./CountUpValue";

interface KnowledgeBaseViewProps {
  documents: SourceDocument[];
  status: BackendStatus;
  error: string | null;
  onRetry: () => void;
}

export function KnowledgeBaseView({ documents, status, error, onRetry }: KnowledgeBaseViewProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"ALL" | DocumentCategory>("ALL");

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return documents.filter((document) => {
      const matchesCategory = category === "ALL" || document.category === category;
      const matchesQuery =
        !normalizedQuery ||
        document.title.toLocaleLowerCase("vi").includes(normalizedQuery) ||
        document.excerpt.toLocaleLowerCase("vi").includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, documents, query]);

  const totalChunks = documents.reduce((total, document) => total + document.chunks, 0);
  const hasCorpus = documents.length > 0;

  if (!hasCorpus && status !== "ready") {
    const isLoading = status === "loading";
    return (
      <section className="content-view knowledge-view">
        <article className="view-card corpus-state" data-liquid-surface="macro">
          <div className="corpus-state-icon"><FileSearch size={23} /></div>
          <div>
            <span className="eyebrow">Knowledge base connection</span>
            <h2>{isLoading ? "Đang tải corpus thật" : "Chưa tải được kho tài liệu"}</h2>
            <p>{isLoading ? "Đang đọc tài liệu từ RAG API…" : error ?? "RAG API chưa trả về dữ liệu tài liệu."}</p>
          </div>
          {!isLoading ? (
            <button className="text-button" data-liquid-ripple type="button" onClick={onRetry}>
              <RefreshCw size={15} /> Thử lại
            </button>
          ) : null}
        </article>
      </section>
    );
  }

  return (
    <section className="content-view knowledge-view">
      {status !== "ready" && error ? (
        <div className="inline-connection-note" role="status"><CircleAlert size={15} /> {error}</div>
      ) : null}
      <div className="summary-grid knowledge-summary">
        <article className="summary-card accent-card" data-liquid-surface="micro">
          <span>Tổng tài liệu</span>
          <strong><CountUpValue value={documents.length} /></strong>
          <p>Nguồn tài liệu trong ChromaDB</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>Legal documents</span>
          <strong><CountUpValue value={documents.filter((document) => document.category === "LEGAL").length} /></strong>
          <p>Chính sách và quy định</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>News & guides</span>
          <strong><CountUpValue value={documents.filter((document) => document.category === "NEWS").length} /></strong>
          <p>Thông báo và hướng dẫn</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>Indexed chunks</span>
          <strong><CountUpValue value={totalChunks} /></strong>
          <p>Chunks đã lập chỉ mục</p>
        </article>
      </div>

      <div className="view-card document-table-card" data-liquid-surface="macro">
        <div className="view-card-header document-toolbar">
          <div>
            <span className="eyebrow">Knowledge base</span>
            <h2>{hasCorpus ? "Tài liệu đã chuẩn hóa" : "Corpus đang trống"}</h2>
          </div>
          {hasCorpus ? (
            <div className="toolbar-controls">
              <label className="table-search">
                <Search size={16} />
                <input
                  value={query}
                  placeholder="Tìm tài liệu..."
                  aria-label="Tìm trong kho tài liệu"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="category-filter">
                <Filter size={15} />
                <select
                  value={category}
                  aria-label="Lọc loại tài liệu"
                  onChange={(event) => setCategory(event.target.value as "ALL" | DocumentCategory)}
                >
                  <option value="ALL">Tất cả</option>
                  <option value="LEGAL">Legal</option>
                  <option value="NEWS">News</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>

        <div className="document-list" role="list">
          {filteredDocuments.map((document) => (
            <article
              key={document.id}
              className="document-row"
              data-liquid-surface="micro"
              data-liquid-ripple
              role="listitem"
            >
              <div className="document-icon"><FileSearch size={20} /></div>
              <div className="document-primary">
                <div className="document-title-line">
                  <h3>{document.title}</h3>
                  <span className={`document-badge ${document.category.toLowerCase()}`}>{document.category}</span>
                </div>
                <p>{document.excerpt}</p>
              </div>
              <div className="document-stat"><span>Chunks</span><strong>{document.chunks}</strong></div>
              <div className="document-stat"><span>Index lúc</span><strong>{document.indexedAt || "Có trong index"}</strong></div>
              <div className="indexed-state"><CheckCircle2 size={15} /> Indexed</div>
            </article>
          ))}
          {filteredDocuments.length === 0 ? (
            <div className="no-table-results">
              {hasCorpus ? "Không tìm thấy tài liệu phù hợp." : "Corpus hiện chưa có tài liệu đã index."}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
