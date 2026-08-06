import {
  ArrowUpRight,
  BookMarked,
  Check,
  ExternalLink,
  GitBranch,
  PanelRightClose,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { BackendStatus, ComponentHealth, SourceDocument } from "../types";

const SOURCE_PANEL_ID = "campusiq-source-panel";
const SOURCE_DRAWER_QUERY = "(max-width: 1230px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute("inert") && element.getClientRects().length > 0);
}

interface SourcePanelProps {
  backendStatus: BackendStatus;
  isOpen: boolean;
  pageIndexHealth: ComponentHealth | null;
  /** The source trigger receives focus again after the drawer closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  selectedSourceId: string | null;
  sources: SourceDocument[];
  onClose: () => void;
  onSelect: (sourceId: string) => void;
}

export function SourcePanel({
  backendStatus,
  isOpen,
  pageIndexHealth,
  returnFocusRef,
  selectedSourceId,
  sources,
  onClose,
  onSelect,
}: SourcePanelProps) {
  const sourcePanelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const isSourceDrawer = useMediaQuery(SOURCE_DRAWER_QUERY);
  const pageIndexState = pageIndexHealth?.status ?? "waiting";
  const pageIndexLabel = pageIndexHealth
    ? `PageIndex ${pageIndexHealth.status === "ready" ? "sẵn sàng" : "đang chờ"}`
    : backendStatus === "loading"
      ? "Đang kiểm tra PageIndex"
      : backendStatus === "offline"
        ? "Không thể kiểm tra PageIndex"
        : "PageIndex chưa báo cáo";
  const pageIndexDetail = pageIndexHealth?.detail ?? pageIndexLabel;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isSourceDrawer || !isOpen) return undefined;

    const sourcePanel = sourcePanelRef.current;
    if (!sourcePanel) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(sourcePanel);
      if (focusable.length === 0) {
        event.preventDefault();
        sourcePanel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !sourcePanel.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !sourcePanel.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const focusTarget = returnFocusRef?.current ?? previouslyFocused;
      if (focusTarget && document.contains(focusTarget)) focusTarget.focus();
    };
  }, [isOpen, isSourceDrawer, returnFocusRef]);

  return (
    <>
      <button
        className={`source-panel-backdrop ${isOpen ? "is-visible" : ""}`}
        type="button"
        aria-hidden={!isSourceDrawer || !isOpen}
        tabIndex={isSourceDrawer && isOpen ? 0 : -1}
        aria-label="Đóng nguồn tham khảo"
        onClick={onClose}
      />
      <aside
        ref={sourcePanelRef}
        id={SOURCE_PANEL_ID}
        className={`source-panel ${isOpen ? "is-open" : ""}`}
        data-liquid-surface="macro"
        role={isSourceDrawer ? "dialog" : undefined}
        aria-label={isSourceDrawer ? "Nguồn tham khảo" : undefined}
        aria-modal={isSourceDrawer && isOpen ? true : undefined}
        aria-hidden={isSourceDrawer && !isOpen ? true : undefined}
        inert={isSourceDrawer && !isOpen}
        tabIndex={isSourceDrawer ? -1 : undefined}
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
          ref={closeButtonRef}
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
                  <span className={`source-verification ${source.verified ? "is-verified" : "is-unverified"}`}>
                    {source.verified ? <Check size={13} /> : null}
                    {source.verified ? "Đã xác minh" : "Chưa xác minh"}
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
        <div
          className={`pageindex-status pageindex-status--${pageIndexState}`}
          role="status"
          aria-live="polite"
          title={pageIndexDetail}
        >
          <span className="status-dot" />
          <span>{pageIndexLabel}</span>
        </div>
      </div>
      </aside>
    </>
  );
}
