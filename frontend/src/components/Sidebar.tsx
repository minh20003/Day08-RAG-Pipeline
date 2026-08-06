import { useEffect, useRef, useState, type RefObject } from "react";
import {
  BarChart3,
  BookOpenText,
  Bot,
  ChevronLeft,
  CircleUserRound,
  Database,
  MessageSquarePlus,
  PanelLeftClose,
  Sparkles,
} from "lucide-react";
import type { ConversationSummary, ViewId } from "../types";
import { GradientText } from "./liquid/GradientText";

const navigationItems: Array<{
  id: ViewId;
  label: string;
  icon: typeof Bot;
}> = [
  { id: "assistant", label: "Trợ lý AI", icon: Bot },
  { id: "library", label: "Kho tài liệu", icon: BookOpenText },
  { id: "evaluation", label: "RAG Analytics", icon: BarChart3 },
  { id: "system", label: "Trạng thái hệ thống", icon: Database },
];

const SIDEBAR_ID = "campusiq-sidebar";
const MOBILE_DRAWER_QUERY = "(max-width: 900px)";
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

interface SidebarProps {
  activeView: ViewId;
  conversations: ConversationSummary[];
  isOpen: boolean;
  /** The menu control receives focus again after the mobile drawer closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onConversationSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onViewChange: (view: ViewId) => void;
}

export function Sidebar({
  activeView,
  conversations,
  isOpen,
  returnFocusRef,
  onClose,
  onConversationSelect,
  onNewChat,
  onViewChange,
}: SidebarProps) {
  const closeTimer = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const isMobileDrawer = useMediaQuery(MOBILE_DRAWER_QUERY);
  const activeIndex = Math.max(0, navigationItems.findIndex((item) => item.id === activeView));

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isMobileDrawer || !isOpen) return undefined;

    const sidebar = sidebarRef.current;
    if (!sidebar) return undefined;
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

      const focusable = getFocusableElements(sidebar);
      if (focusable.length === 0) {
        event.preventDefault();
        sidebar.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !sidebar.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !sidebar.contains(activeElement))) {
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
  }, [isMobileDrawer, isOpen, returnFocusRef]);

  const selectView = (view: ViewId) => {
    onViewChange(view);
    if (!isMobileDrawer) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(onClose, 130);
  };

  const selectConversation = (conversationId: string) => {
    onConversationSelect(conversationId);
    selectView("assistant");
  };

  return (
    <>
      <button
        className={`sidebar-backdrop ${isOpen ? "is-visible" : ""}`}
        type="button"
        aria-hidden={!isMobileDrawer || !isOpen}
        tabIndex={isMobileDrawer && isOpen ? 0 : -1}
        aria-label="Đóng thanh điều hướng"
        onClick={onClose}
      />
      <aside
        ref={sidebarRef}
        id={SIDEBAR_ID}
        className={`sidebar ${isOpen ? "is-open" : ""}`}
        role={isMobileDrawer ? "dialog" : undefined}
        aria-label={isMobileDrawer ? "Thanh điều hướng" : undefined}
        aria-modal={isMobileDrawer && isOpen ? true : undefined}
        aria-hidden={isMobileDrawer && !isOpen ? true : undefined}
        inert={isMobileDrawer && !isOpen}
        tabIndex={isMobileDrawer ? -1 : undefined}
      >
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={19} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">
              <GradientText
                colors={["#7c8cff", "#71cfff", "#c5a8ff", "#7c8cff"]}
                animationSpeed={9}
                direction="horizontal"
                yoyo
              >
                CampusIQ
              </GradientText>
            </div>
            <div className="brand-caption">University intelligence</div>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button sidebar-close"
            type="button"
            aria-label="Đóng menu"
            onClick={onClose}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button
          className="new-chat-button"
          data-liquid-ripple
          data-liquid-surface="micro"
          type="button"
          onClick={onNewChat}
        >
          <MessageSquarePlus size={18} />
          Cuộc trò chuyện mới
        </button>

        <nav
          className="main-navigation"
          aria-label="Điều hướng chính"
          data-active-index={activeIndex}
        >
          <span
            className="nav-liquid-indicator"
            aria-hidden="true"
          >
            <span
              key={activeView}
              className="nav-liquid-indicator__glint"
            />
          </span>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? "is-active" : ""}`}
                data-liquid-ripple
                data-nav-ripple
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectView(item.id)}
              >
                <span className="nav-icon-motion" data-magnetic data-magnetic-strength="4" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.9} />
                </span>
                <span className="nav-label">{item.label}</span>
                <span className="nav-chevron-slot" aria-hidden="true">
                  <ChevronLeft className="nav-indicator" size={14} />
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-divider" />
        <div className="recent-section">
          <p className="eyebrow">Gần đây</p>
          <div className="recent-list">
            {conversations.length > 0 ? (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className="recent-item"
                  type="button"
                  onClick={() => selectConversation(conversation.id)}
                >
                  <span>{conversation.title}</span>
                  <small>{conversation.time}</small>
                </button>
              ))
            ) : (
              <p className="recent-empty">Các câu hỏi thật của bạn sẽ xuất hiện ở đây.</p>
            )}
          </div>
        </div>

        <div className="team-card">
          <div className="team-avatar" aria-hidden="true">
            <CircleUserRound size={19} />
          </div>
          <div>
            <strong>Team B4</strong>
            <span>Role 5 · Frontend</span>
          </div>
        </div>
      </aside>
    </>
  );
}
