import { Menu, MoonStar, PanelRightOpen, Sun } from "lucide-react";
import type { RefObject } from "react";
import type { BackendStatus, ThemeMode, ViewId } from "../types";

const viewLabels: Record<ViewId, { title: string; subtitle: string }> = {
  assistant: {
    title: "Trợ lý RMIT",
    subtitle: "Hybrid retrieval · Citation-first",
  },
  library: {
    title: "Kho tài liệu",
    subtitle: "Corpus thật · Metadata · Indexing",
  },
  evaluation: {
    title: "RAG Analytics",
    subtitle: "Corpus · Truy vấn · Retrieval telemetry",
  },
  system: {
    title: "Trạng thái hệ thống",
    subtitle: "Live health · Public origin · Services",
  },
};

const connectionLabels: Record<BackendStatus, string> = {
  loading: "Đang kiểm tra hệ thống",
  ready: "RAG API đang hoạt động",
  degraded: "Một phần dịch vụ chưa sẵn sàng",
  offline: "Không kết nối được RAG API",
};

interface TopbarProps {
  activeView: ViewId;
  backendStatus: BackendStatus;
  theme: ThemeMode;
  isThemeAnimating: boolean;
  sidebarOpen: boolean;
  sourcesOpen: boolean;
  sourceCount: number;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  sourcesButtonRef?: RefObject<HTMLButtonElement | null>;
  onMenuOpen: () => void;
  onSourcesOpen: () => void;
  onThemeToggle: (origin: { x: number; y: number }) => void;
}

export function Topbar({
  activeView,
  backendStatus,
  theme,
  isThemeAnimating,
  sidebarOpen,
  sourcesOpen,
  sourceCount,
  menuButtonRef,
  sourcesButtonRef,
  onMenuOpen,
  onSourcesOpen,
  onThemeToggle,
}: TopbarProps) {
  const label = viewLabels[activeView];

  return (
    <header className="topbar" data-liquid-surface="macro">
      <button
        ref={menuButtonRef}
        id="campusiq-menu-trigger"
        className="icon-button mobile-menu-button"
        data-liquid-ripple
        data-magnetic
        type="button"
        aria-controls="campusiq-sidebar"
        aria-expanded={sidebarOpen}
        aria-haspopup="dialog"
        aria-label="Mở menu"
        onClick={onMenuOpen}
      >
        <Menu size={20} />
      </button>

      <div className="page-heading">
        <div className="heading-line">
          <h1>{label.title}</h1>
        </div>
        <p>{label.subtitle}</p>
      </div>

      <div className="topbar-actions">
        <span
          className={`system-health system-health--${backendStatus}`}
          role="status"
          aria-label={connectionLabels[backendStatus]}
          title={connectionLabels[backendStatus]}
        >
          <span className="status-dot" />
          <span className="system-health__label">{connectionLabels[backendStatus]}</span>
        </span>
        {activeView === "assistant" ? (
          <button
            ref={sourcesButtonRef}
            id="campusiq-sources-trigger"
            className="icon-button mobile-sources-button"
            data-liquid-ripple
            data-magnetic
            type="button"
            aria-controls="campusiq-source-panel"
            aria-expanded={sourcesOpen}
            aria-haspopup="dialog"
            aria-label={`Mở ${sourceCount} nguồn tham khảo`}
            onClick={onSourcesOpen}
          >
            <PanelRightOpen size={19} />
            {sourceCount > 0 ? <span>{sourceCount}</span> : null}
          </button>
        ) : null}
        <button
          className={`theme-toggle ${isThemeAnimating ? "is-bursting" : ""}`}
          type="button"
          aria-label={theme === "light" ? "Bật dark mode" : "Bật light mode"}
          aria-pressed={theme === "dark"}
          disabled={isThemeAnimating}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            onThemeToggle({
              x: bounds.left + bounds.width / 2,
              y: bounds.top + bounds.height / 2,
            });
          }}
        >
          <span className="theme-toggle__icon" data-magnetic aria-hidden="true">
            {theme === "light" ? <MoonStar size={18} /> : <Sun size={18} />}
          </span>
        </button>
      </div>
    </header>
  );
}
