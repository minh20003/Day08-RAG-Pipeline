import { useEffect, useRef, type CSSProperties } from "react";
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

const NAV_ROW_HEIGHT = 42;
const NAV_ROW_GAP = 5;

interface SidebarProps {
  activeView: ViewId;
  conversations: ConversationSummary[];
  isOpen: boolean;
  onClose: () => void;
  onConversationSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onViewChange: (view: ViewId) => void;
}

export function Sidebar({
  activeView,
  conversations,
  isOpen,
  onClose,
  onConversationSelect,
  onNewChat,
  onViewChange,
}: SidebarProps) {
  const closeTimer = useRef<number | null>(null);
  const activeIndex = Math.max(0, navigationItems.findIndex((item) => item.id === activeView));
  const indicatorStyle = {
    "--nav-active-y": `${activeIndex * (NAV_ROW_HEIGHT + NAV_ROW_GAP)}px`,
  } as CSSProperties;

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const selectView = (view: ViewId) => {
    onViewChange(view);
    if (!window.matchMedia("(max-width: 900px)").matches) return;
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
        aria-label="Đóng thanh điều hướng"
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={19} strokeWidth={2.2} />
          </div>
          <div>
            <div className="brand-name">CampusIQ</div>
            <div className="brand-caption">University intelligence</div>
          </div>
          <button
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
          data-magnetic
          type="button"
          onClick={onNewChat}
        >
          <MessageSquarePlus size={18} />
          Cuộc trò chuyện mới
        </button>

        <nav className="main-navigation" aria-label="Điều hướng chính">
          <span
            className="nav-liquid-indicator"
            aria-hidden="true"
            style={indicatorStyle}
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
