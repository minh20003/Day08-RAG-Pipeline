import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { EvaluationView } from "./components/EvaluationView";
import { KnowledgeBaseView } from "./components/KnowledgeBaseView";
import { MotionProvider } from "./components/MotionProvider";
import { Sidebar } from "./components/Sidebar";
import { SourcePanel } from "./components/SourcePanel";
import { SystemStatusView } from "./components/SystemStatusView";
import { Topbar } from "./components/Topbar";
import {
  loadStoredConversations,
  toConversationSummaries,
  upsertStoredConversation,
} from "./services/conversation-store";
import { ragClient } from "./services/rag-client";
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
  return reason instanceof Error ? reason.message : "Không thể kết nối RAG API.";
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
    .find((message) => message.role === "assistant" && message.status !== "error" && message.sources?.length)
    ?.sources ?? [];
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
    const requestId = ++refreshRequestId.current;
    const startedAt = performance.now();
    setBackend((current) => ({ ...current, isRefreshing: true, error: null }));

    const [healthResult, documentsResult] = await Promise.allSettled([
      ragClient.health(),
      ragClient.listDocuments(),
    ]);
    if (requestId !== refreshRequestId.current) return;

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
      health: health ?? current.health,
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
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshBackend]);

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

  const submitQuery = useCallback(async () => {
    const query = input.trim();
    if (!query || isLoading) return;
    const userTime = createTimestamp();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      ...userTime,
    };

    setActiveView("assistant");
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await ragClient.query({
        message: query,
        conversationId,
        topK,
        useReranking: true,
      });
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
      const errorTime = createTimestamp();
      const message = getErrorMessage(error);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Không thể kết nối hệ thống truy xuất lúc này. Vui lòng kiểm tra RAG API và thử lại.",
          trace: { steps: ["API error"], latency: "—", mode: "none" },
          status: "error",
          ...errorTime,
        },
      ]);
      setSources([]);
      setToast(message);
      void refreshBackend();
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, input, isLoading, refreshBackend, topK]);

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
  };

  const openCitation = (messageId: string, citationNumber: number) => {
    const messageSources = messages.find((message) => message.id === messageId)?.sources ?? [];
    const source = messageSources[citationNumber - 1];
    if (!source) return;
    setSources(messageSources);
    setSelectedSourceId(source.id);
    setSourcesOpen(true);
  };

  const renderActiveView = () => {
    switch (activeView) {
      case "library":
        return <KnowledgeBaseView documents={backend.documents} status={backend.status} error={backend.error} onRetry={() => void refreshBackend()} />;
      case "evaluation":
        return <EvaluationView backend={backend} conversations={conversations} />;
      case "system":
        return <SystemStatusView backend={backend} onRefresh={() => void refreshBackend()} />;
      default:
        return (
          <ChatWorkspace
            input={input}
            isLoading={isLoading}
            messages={messages}
            suggestions={suggestions}
            topK={topK}
            onCitation={openCitation}
            onInputChange={setInput}
            onSubmit={() => void submitQuery()}
            onSuggestion={setInput}
            onTopKChange={setTopK}
          />
        );
    }
  };

  const isAssistantView = activeView === "assistant";

  return (
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
        <Sidebar
          activeView={activeView}
          conversations={conversationSummaries}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onConversationSelect={selectConversation}
          onNewChat={startNewChat}
          onViewChange={setActiveView}
        />

        <main className="main-column">
          <Topbar
            activeView={activeView}
            backendStatus={backend.status}
            theme={theme}
            isThemeAnimating={isThemeAnimating}
            sourceCount={sources.length}
            onMenuOpen={() => setSidebarOpen(true)}
            onSourcesOpen={() => setSourcesOpen(true)}
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
            isOpen={sourcesOpen}
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
  );
}
