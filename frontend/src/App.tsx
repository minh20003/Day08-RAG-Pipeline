import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { MotionProvider } from "./components/MotionProvider";
import { Sidebar } from "./components/Sidebar";
import { SourcePanel } from "./components/SourcePanel";
import { Topbar } from "./components/Topbar";
import { GlassBackdrop } from "./components/liquid/GlassBackdrop";

const KnowledgeBaseView = lazy(() =>
  import("./components/KnowledgeBaseView").then((m) => ({ default: m.KnowledgeBaseView })),
);
const EvaluationView = lazy(() =>
  import("./components/EvaluationView").then((m) => ({ default: m.EvaluationView })),
);
const SystemStatusView = lazy(() =>
  import("./components/SystemStatusView").then((m) => ({ default: m.SystemStatusView })),
);
import {
  loadStoredConversations,
  toConversationSummaries,
  upsertStoredConversation,
} from "./services/conversation-store";
import { isRagClientError, ragClient } from "./services/rag-client";
import type {
  BackendSnapshot,
  ChatMessage,
  HealthResponse,
  SourceDocument,
  StoredConversation,
  ThemeMode,
  ViewId,
} from "./types";

const THEME_STORAGE_KEY = "campusiq:theme:v1";
const BACKEND_POLL_INTERVAL = 30_000;

const EMPTY_BACKEND: BackendSnapshot = {
  status: "loading",
  isRefreshing: false,
  health: null,
  documents: [],
  lastCheckedAt: null,
  latencyMs: null,
  error: null,
};

interface ThemeBurstState {
  id: string;
  nextTheme: ThemeMode;
  x: number;
  y: number;
}

interface ThemeViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
}

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ThemeViewTransition;
};

const THEME_SPARKS = Array.from({ length: 26 }, (_, index) => ({
  angle: (index * 137.508) % 360,
  delay: (index % 6) * 0.025,
  distance: 70 + (index % 7) * 17,
  id: index,
  size: 3 + (index % 4) * 1.5,
}));

function getInitialTheme(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "light";
}

function syncDocumentTheme(nextTheme: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = nextTheme;
  root.style.colorScheme = nextTheme;
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", nextTheme === "light" ? "#f7f9fc" : "#0b1020");
}

function createTimestamp() {
  const now = new Date();
  return {
    timestamp: new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(now),
    timestampIso: now.toISOString(),
  };
}

function getErrorMessage(reason: unknown) {
  if (isRagClientError(reason)) {
    switch (reason.code) {
      case "timeout":
        return "Máy chủ mất quá lâu để phản hồi. Hãy thử lại.";
      case "aborted":
        return "Yêu cầu đã được hủy.";
      case "network":
        return "Bạn đang ngoại tuyến hoặc RAG API chưa chạy.";
      case "invalid-response":
        return "RAG API trả về dữ liệu không hợp lệ.";
      default:
        return reason.message;
    }
  }
  return reason instanceof Error ? reason.message : "Không thể kết nối RAG API.";
}

function getChatErrorContent(reason: unknown) {
  if (isRagClientError(reason)) {
    switch (reason.code) {
      case "timeout":
        return "Yêu cầu mất quá lâu để hoàn tất. Bạn có thể thử lại.";
      case "aborted":
        return "Đã hủy yêu cầu này. Bạn có thể thử lại khi sẵn sàng.";
      case "network":
        return "Không thể kết nối RAG API. Kiểm tra kết nối rồi thử lại.";
      case "invalid-response":
        return "RAG API trả về dữ liệu không đúng định dạng. Bạn có thể thử lại.";
      default:
        return "RAG API trả về lỗi. Bạn có thể thử lại.";
    }
  }
  return "Không thể kết nối hệ thống truy xuất lúc này. Bạn có thể thử lại.";
}

function makeSuggestions(documents: SourceDocument[]) {
  return documents.slice(0, 3).map((document) => {
    const title = document.title.length > 52 ? `${document.title.slice(0, 51).trimEnd()}…` : document.title;
    return document.category === "LEGAL"
      ? `Thông tin quan trọng trong “${title}” là gì?`
      : `Tóm tắt “${title}”.`;
  });
}

function getLastResponseSources(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => (
      message.role === "assistant" &&
      message.status !== "error" &&
      message.status !== "cancelled" &&
      message.sources?.length
    ))
    ?.sources ?? [];
}

function ViewLoadingFallback() {
  return (
    <div className="content-view">
      <div className="liquid-view-loading">
        <span className="liquid-view-loading__pulse" aria-hidden="true" />
        <span>Đang tải chế độ xem…</span>
      </div>
    </div>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>("assistant");
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [themeBurst, setThemeBurst] = useState<ThemeBurstState | null>(null);
  const [isThemeAnimating, setIsThemeAnimating] = useState(false);
  const [backend, setBackend] = useState<BackendSnapshot>(EMPTY_BACKEND);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [topK, setTopK] = useState(5);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversations, setConversations] = useState<StoredConversation[]>(loadStoredConversations);
  const refreshRequestId = useRef(0);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const chatControllerRef = useRef<AbortController | null>(null);
  const chatRequestId = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sourcesButtonRef = useRef<HTMLButtonElement>(null);

  const suggestions = useMemo(() => makeSuggestions(backend.documents), [backend.documents]);
  const conversationSummaries = useMemo(() => toConversationSummaries(conversations), [conversations]);

  useLayoutEffect(() => {
    syncDocumentTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const refreshBackend = useCallback(async () => {
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const requestId = ++refreshRequestId.current;
    const startedAt = performance.now();
    setBackend((current) => ({ ...current, isRefreshing: true, error: null }));

    const [healthResult, documentsResult] = await Promise.allSettled([
      ragClient.health({ signal: controller.signal }),
      ragClient.listDocuments({ signal: controller.signal }),
    ]);
    if (controller.signal.aborted || requestId !== refreshRequestId.current) return;

    const health = healthResult.status === "fulfilled" ? healthResult.value : null;
    const documents = documentsResult.status === "fulfilled" ? documentsResult.value : null;
    const errors = [healthResult, documentsResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getErrorMessage(result.reason));
    const allServicesReady = health
      ? Object.values(health.components).every((component) => component.status === "ready")
      : false;
    const status = health && documents
      ? (allServicesReady ? "ready" : "degraded")
      : health || documents
        ? "degraded"
        : "offline";

    setBackend((current) => ({
      status,
      isRefreshing: false,
      health,
      documents: documents ?? current.documents,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
      error: errors[0] ?? null,
    }));
  }, []);

  useEffect(() => {
    void refreshBackend();
    const refreshWhenVisible = () => {
      if (!document.hidden) void refreshBackend();
    };
    const interval = window.setInterval(refreshWhenVisible, BACKEND_POLL_INTERVAL);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      refreshControllerRef.current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBackend]);

  useEffect(() => () => {
    chatControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!messages.some((message) => message.role === "user")) return;
    const updatedAt = messages.at(-1)?.timestampIso ?? new Date().toISOString();
    setConversations((current) => upsertStoredConversation(current, {
      id: conversationId,
      messages,
      updatedAt,
    }));
  }, [conversationId, messages]);

  useEffect(() => {
    if (!themeBurst) return undefined;
    const timeout = window.setTimeout(() => {
      setThemeBurst(null);
      setIsThemeAnimating(false);
    }, 1550);
    return () => window.clearTimeout(timeout);
  }, [themeBurst]);

  const handleThemeToggle = useCallback(
    ({ x, y }: { x: number; y: number }) => {
      if (isThemeAnimating) return;
      const nextTheme: ThemeMode = theme === "light" ? "dark" : "light";
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const commitTheme = () => {
        syncDocumentTheme(nextTheme);
        flushSync(() => setTheme(nextTheme));
      };
      if (reduceMotion) {
        commitTheme();
        return;
      }

      const root = document.documentElement;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      const burst: ThemeBurstState = { id: crypto.randomUUID(), nextTheme, x, y };
      root.style.setProperty("--theme-burst-x", `${x}px`);
      root.style.setProperty("--theme-burst-y", `${y}px`);
      root.style.setProperty("--theme-burst-radius", `${Math.ceil(radius)}px`);
      root.classList.add("theme-transition-active");
      setIsThemeAnimating(true);

      const transitionDocument = document as ThemeTransitionDocument;
      if (!transitionDocument.startViewTransition) {
        commitTheme();
        root.classList.remove("theme-transition-active");
        setIsThemeAnimating(false);
        return;
      }

      try {
        const transition = transitionDocument.startViewTransition(commitTheme);
        void transition.ready.then(() => setThemeBurst(burst)).catch(() => setThemeBurst(burst));
        void transition.finished.finally(() => root.classList.remove("theme-transition-active")).catch(() => undefined);
      } catch {
        commitTheme();
        root.classList.remove("theme-transition-active");
        setIsThemeAnimating(false);
      }
    },
    [isThemeAnimating, theme],
  );

  const requestAnswer = useCallback(async (
    query: string,
    options: { appendUser: boolean; replaceMessageId?: string },
  ) => {
    if (!query || isLoading) return;

    chatControllerRef.current?.abort();
    const controller = new AbortController();
    chatControllerRef.current = controller;
    const requestId = ++chatRequestId.current;

    if (options.appendUser) {
      const userTime = createTimestamp();
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: query,
        ...userTime,
      };
      setMessages((current) => [...current, userMessage]);
    } else if (options.replaceMessageId) {
      setMessages((current) => current.filter((message) => message.id !== options.replaceMessageId));
    }

    setActiveView("assistant");
    setIsLoading(true);

    try {
      const response = await ragClient.query({
        message: query,
        conversationId,
        topK,
        useReranking: true,
      }, { signal: controller.signal });

      if (controller.signal.aborted || requestId !== chatRequestId.current) return;

      const assistantTime = createTimestamp();
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.answer,
        sourceIds: response.sources.map((source) => source.id),
        sources: response.sources,
        trace: response.trace,
        status: "success",
        ...assistantTime,
      };
      setMessages((current) => [...current, assistantMessage]);
      setSources(response.sources);
      setSelectedSourceId(response.sources[0]?.id ?? null);
    } catch (error) {
      if (requestId !== chatRequestId.current) return;
      const errorTime = createTimestamp();
      const cancelled = isRagClientError(error) && error.code === "aborted";
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: getChatErrorContent(error),
          trace: { steps: [cancelled ? "Request cancelled" : "API error"], latency: "—", mode: "none" },
          status: cancelled ? "cancelled" : "error",
          ...errorTime,
        },
      ]);
      setSources([]);
      setSelectedSourceId(null);
      setToast(getErrorMessage(error));
      if (!cancelled) void refreshBackend();
    } finally {
      if (requestId === chatRequestId.current) {
        setIsLoading(false);
        chatControllerRef.current = null;
      }
    }
  }, [conversationId, isLoading, refreshBackend, topK]);

  const submitQuery = useCallback(() => {
    const query = input.trim();
    if (!query || isLoading) return;
    setInput("");
    void requestAnswer(query, { appendUser: true });
  }, [input, isLoading, requestAnswer]);

  const cancelQuery = useCallback(() => {
    chatControllerRef.current?.abort();
  }, []);

  const retryAnswer = useCallback((messageId: string) => {
    if (isLoading) return;
    const answerIndex = messages.findIndex((message) => message.id === messageId);
    const query = answerIndex > 0 && messages[answerIndex - 1]?.role === "user"
      ? messages[answerIndex - 1].content
      : "";
    if (!query) return;
    void requestAnswer(query, { appendUser: false, replaceMessageId: messageId });
  }, [isLoading, messages, requestAnswer]);

  const startNewChat = () => {
    if (isLoading) {
      setToast("Đợi phản hồi hiện tại hoàn tất trước khi tạo cuộc trò chuyện mới.");
      return;
    }
    setMessages([]);
    setSources([]);
    setSelectedSourceId(null);
    setConversationId(crypto.randomUUID());
    setInput("");
    setActiveView("assistant");
    setSidebarOpen(false);
    setSourcesOpen(false);
    setToast("Đã tạo cuộc trò chuyện mới");
  };

  const selectConversation = (selectedConversationId: string) => {
    if (isLoading) {
      setToast("Đợi phản hồi hiện tại hoàn tất trước khi đổi cuộc trò chuyện.");
      return;
    }
    const conversation = conversations.find((item) => item.id === selectedConversationId);
    if (!conversation) return;
    const restoredSources = getLastResponseSources(conversation.messages);
    setConversationId(conversation.id);
    setMessages(conversation.messages);
    setSources(restoredSources);
    setSelectedSourceId(restoredSources[0]?.id ?? null);
    setInput("");
    setActiveView("assistant");
    setSidebarOpen(false);
  };

  const openSidebar = useCallback(() => {
    setSourcesOpen(false);
    setSidebarOpen(true);
  }, []);

  const openSources = useCallback(() => {
    setSidebarOpen(false);
    setSourcesOpen(true);
  }, []);

  const changeView = useCallback((view: ViewId) => {
    setActiveView(view);
    setSidebarOpen(false);
    if (view !== "assistant") setSourcesOpen(false);
  }, []);

  const openCitation = (messageId: string, citationNumber: number) => {
    const messageSources = messages.find((message) => message.id === messageId)?.sources ?? [];
    const source = messageSources[citationNumber - 1];
    if (!source) return;
    setSources(messageSources);
    setSelectedSourceId(source.id);
    openSources();
  };

  const renderActiveView = () => {
    switch (activeView) {
      case "library":
        return (
          <Suspense fallback={<ViewLoadingFallback />}>
            <KnowledgeBaseView documents={backend.documents} status={backend.status} error={backend.error} onRetry={() => void refreshBackend()} />
          </Suspense>
        );
      case "evaluation":
        return (
          <Suspense fallback={<ViewLoadingFallback />}>
            <EvaluationView backend={backend} conversations={conversations} />
          </Suspense>
        );
      case "system":
        return (
          <Suspense fallback={<ViewLoadingFallback />}>
            <SystemStatusView backend={backend} onRefresh={() => void refreshBackend()} />
          </Suspense>
        );
      default:
        return (
          <ChatWorkspace
            input={input}
            isLoading={isLoading}
            messages={messages}
            suggestions={suggestions}
            topK={topK}
            onCitation={openCitation}
            onCancel={cancelQuery}
            onInputChange={setInput}
            onRegenerate={retryAnswer}
            onRetry={retryAnswer}
            onSubmit={() => void submitQuery()}
            onSuggestion={setInput}
            onTopKChange={setTopK}
          />
        );
    }
  };

  const isAssistantView = activeView === "assistant";

  return (
    <MotionConfig reducedMotion="user">
      <MotionProvider paused={isThemeAnimating}>
      <motion.div
        className={`app-shell ${isAssistantView ? "" : "app-shell--wide"}`}
        initial={{ opacity: 0, scale: 0.992 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="liquid-lake" aria-hidden="true">
          <span className="liquid-lake__orb liquid-lake__orb--one" />
          <span className="liquid-lake__orb liquid-lake__orb--two" />
          <span className="liquid-lake__caustics" />
          <span className="liquid-cursor-lens" />
        </div>
        <GlassBackdrop theme={theme} />
          <Sidebar
          activeView={activeView}
          conversations={conversationSummaries}
            isOpen={sidebarOpen}
            returnFocusRef={menuButtonRef}
          onClose={() => setSidebarOpen(false)}
          onConversationSelect={selectConversation}
          onNewChat={startNewChat}
            onViewChange={changeView}
        />

        <main className="main-column">
          <Topbar
            activeView={activeView}
            backendStatus={backend.status}
            theme={theme}
            isThemeAnimating={isThemeAnimating}
            sidebarOpen={sidebarOpen}
            sourcesOpen={sourcesOpen}
            sourceCount={sources.length}
            menuButtonRef={menuButtonRef}
            sourcesButtonRef={sourcesButtonRef}
            onMenuOpen={openSidebar}
            onSourcesOpen={openSources}
            onThemeToggle={handleThemeToggle}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeView}
              className="view-transition-stage"
              initial={{ opacity: 0, y: 12, filter: "blur(7px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(5px)" }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderActiveView()}
            </motion.div>
          </AnimatePresence>
        </main>

        {isAssistantView ? (
          <SourcePanel
            backendStatus={backend.status}
            isOpen={sourcesOpen}
            pageIndexHealth={backend.health?.components.pageindex ?? null}
            returnFocusRef={sourcesButtonRef}
            selectedSourceId={selectedSourceId}
            sources={sources}
            onClose={() => setSourcesOpen(false)}
            onSelect={setSelectedSourceId}
          />
        ) : null}

        {toast ? (
          <div className="toast" role="status">
            <span>{toast}</span>
            <button type="button" aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={15} /></button>
          </div>
        ) : null}

        {themeBurst ? (
          <div
            key={themeBurst.id}
            className={`theme-burst theme-burst--${themeBurst.nextTheme}`}
            aria-hidden="true"
            style={{ "--burst-x": `${themeBurst.x}px`, "--burst-y": `${themeBurst.y}px` } as CSSProperties}
          >
            <span className="theme-burst__aurora" />
            <span className="theme-burst__ring theme-burst__ring--outer" />
            <span className="theme-burst__ring theme-burst__ring--inner" />
            <span className="theme-burst__core" />
            {THEME_SPARKS.map((spark) => (
              <span
                key={spark.id}
                className={`theme-burst__spark theme-burst__spark--${spark.id % 3}`}
                style={{
                  "--spark-angle": `${spark.angle}deg`,
                  "--spark-delay": `${0.86 + spark.delay}s`,
                  "--spark-distance": `${spark.distance}px`,
                  "--spark-size": `${spark.size}px`,
                } as CSSProperties}
              />
            ))}
          </div>
        ) : null}
      </motion.div>
      </MotionProvider>
    </MotionConfig>
  );
}
