import {
  ArrowUpRight,
  BookMarked,
  Check,
  ExternalLink,
  GitBranch,
  PanelRightClose,
} from "lucide-react";
import type { SourceDocument } from "../types";

interface SourcePanelProps {
  isOpen: boolean;
  selectedSourceId: string | null;
  sources: SourceDocument[];
  onClose: () => void;
  onSelect: (sourceId: string) => void;
}

export function SourcePanel({
  isOpen,
  selectedSourceId,
  sources,
  onClose,
  onSelect,
}: SourcePanelProps) {
  return (
    <aside
      className={`source-panel ${isOpen ? "is-open" : ""}`}
      data-liquid-surface="macro"
    >
      <div className="source-panel-header">
        <div>
          <span className="panel-kicker">Evidence</span>
          <h2>
            <BookMarked size={18} />
            Nguồn tham khảo <span>{sources.length}</span>
          </h2>
        </div>
        <button
          className="icon-button source-close"
          type="button"
          aria-label="Đóng nguồn tham khảo"
          onClick={onClose}
        >
          <PanelRightClose size={18} />
        </button>
      </div>

      <div className="source-list">
        {sources.length === 0 ? (
          <div className="empty-sources">
            <BookMarked size={24} />
            <strong>Chưa có nguồn được sử dụng</strong>
            <p>Nguồn tài liệu sẽ xuất hiện sau khi có câu trả lời đủ evidence.</p>
          </div>
        ) : (
          sources.map((source, index) => {
            const isSelected = selectedSourceId === source.id;
            return (
              <article
                key={source.id}
                className={`source-card ${isSelected ? "is-selected" : ""}`}
                data-liquid-ripple
                data-liquid-surface="micro"
              >
                <button
                  className="source-card-select"
                  type="button"
                  aria-label={`Chọn nguồn ${source.title}`}
                  onClick={() => onSelect(source.id)}
                >
                  <span className="source-number">{index + 1}</span>
                  <span className={`document-badge ${source.category.toLowerCase()}`}>
                    {source.category}
                  </span>
                  <span className="method-badge">{source.method}</span>
                  <span className="source-score">{source.score.toFixed(2)}</span>
                </button>
                <h3>{source.title}</h3>
                <p>{source.excerpt}</p>
                <div className="source-footer">
                  <span>
                    {source.verified ? <Check size={13} /> : null}
                    Được xác minh
                  </span>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Mở tài liệu ${source.title}`}
                    >
                      Mở tài liệu <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="pipeline-card" data-liquid-surface="micro">
        <div className="pipeline-card-heading">
          <span>
            <GitBranch size={15} /> RAG pipeline
          </span>
          <ArrowUpRight size={15} />
        </div>
        <div className="pipeline-flow">
          <span>Semantic</span>
          <b>+</b>
          <span>BM25</span>
          <b>→</b>
          <span>RRF</span>
          <b>→</b>
          <span>LLM</span>
        </div>
        <div className="pageindex-status">
          <span className="status-dot" />
          PageIndex sẵn sàng
        </div>
      </div>
    </aside>
  );
}
