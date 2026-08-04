import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  CornerDownLeft,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRound,
} from "lucide-react";
import { motion } from "motion/react";
import type { ChatMessage } from "../types";

interface ChatWorkspaceProps {
  input: string;
  isLoading: boolean;
  messages: ChatMessage[];
  suggestions: string[];
  topK: number;
  onCitation: (messageId: string, citationNumber: number) => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onSuggestion: (prompt: string) => void;
  onTopKChange: (value: number) => void;
}

interface AssistantContentProps {
  content: string;
  messageId: string;
  onCitation: (messageId: string, citationNumber: number) => void;
}

interface TopKControlProps {
  value: number;
  onChange: (value: number) => void;
}

const TOP_K_OPTIONS = [3, 4, 5, 6, 8, 10];
const RAG_STAGES = ["Semantic", "BM25", "RRF", "LLM"];

function TopKControl({ value, onChange }: TopKControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const selectTopK = (nextValue: number) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div ref={controlRef} className="top-k-control">
      <button
        className="top-k-trigger"
        data-liquid-ripple
        data-magnetic
        type="button"
        aria-label={`Số nguồn top k: ${value}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="top-k-label">top_k</span>
        <strong>{value}</strong>
        <ChevronDown className={isOpen ? "is-open" : ""} size={15} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="top-k-menu" role="listbox" aria-label="Số nguồn top k">
          <span className="top-k-menu-title">Nguồn tham chiếu</span>
          <div className="top-k-options">
            {TOP_K_OPTIONS.map((option) => (
              <button
                key={option}
                className={option === value ? "is-selected" : ""}
                data-liquid-ripple
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => selectTopK(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderInlineCitations(
  line: string,
  onCitation: (citationNumber: number) => void,
): ReactNode[] {
  return line.split(/\[(\d+)\]/g).map((part, index) => {
    const citationNumber = Number(part);
    if (index % 2 === 1 && Number.isFinite(citationNumber)) {
      return (
        <button
          key={`citation-${index}-${part}`}
          className="citation-chip"
          data-liquid-ripple
          data-magnetic
          type="button"
          aria-label={`Mở nguồn tham khảo ${citationNumber}`}
          onClick={() => onCitation(citationNumber)}
        >
          {citationNumber}
        </button>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
}

function AssistantContent({ content, messageId, onCitation }: AssistantContentProps) {
  const blocks = content.split("\n");
  return (
    <div className="message-copy">
      {blocks.map((line, index) => {
        if (!line.trim()) {
          return <div key={`space-${index}`} className="message-space" />;
        }
        if (line.startsWith("• ")) {
          return (
            <div key={`bullet-${index}`} className="message-bullet">
              <span aria-hidden="true" />
              <p>{renderInlineCitations(line.slice(2), (citationNumber) => onCitation(messageId, citationNumber))}</p>
            </div>
          );
        }
        return (
          <p key={`paragraph-${index}`}>
            {renderInlineCitations(line, (citationNumber) => onCitation(messageId, citationNumber))}
          </p>
        );
      })}
    </div>
  );
}

function LiquidOrb() {
  return (
    <div className="liquid-orb" data-liquid-surface="micro" aria-hidden="true">
      <svg className="liquid-orb__filter" width="0" height="0">
        <filter id="campusiq-liquid-displacement">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.02"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" />
        </filter>
      </svg>
      <span className="liquid-orb__halo" />
      <span className="liquid-orb__ring liquid-orb__ring--one" />
      <span className="liquid-orb__ring liquid-orb__ring--two" />
      <span className="liquid-orb__core"><Bot size={30} /></span>
      <span className="liquid-orb__glint" />
    </div>
  );
}

function LoadingMessage() {
  return (
    <motion.div
      className="message-row assistant-row"
      aria-live="polite"
      initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="message-avatar assistant-avatar">
        <Sparkles size={16} />
      </div>
      <div className="assistant-message loading-message" data-liquid-surface="micro">
        <div className="loading-title">
          <span className="thinking-dots">
            <i />
            <i />
            <i />
          </span>
          Đang đối chiếu nguồn dữ liệu
        </div>
        <div className="loading-stages">
          <span>Semantic search</span>
          <span>BM25</span>
          <span>RRF rerank</span>
        </div>
        <div className="liquid-rag-flow" aria-label="RAG pipeline đang xử lý">
          {RAG_STAGES.map((stage, index) => (
            <span key={stage} className={`liquid-rag-flow__stage liquid-rag-flow__stage--${index}`}>
              {stage}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export function ChatWorkspace({
  input,
  isLoading,
  messages,
  suggestions,
  topK,
  onCitation,
  onInputChange,
  onSubmit,
  onSuggestion,
  onTopKChange,
}: ChatWorkspaceProps) {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const conversationEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isLoading, messages.length]);

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1600);
    } catch {
      setCopiedMessageId(null);
    }
  };

  return (
    <section className="chat-workspace">
      <div className="chat-scroll-region">
        <div className="conversation-date">
          <span>Hôm nay</span>
        </div>
        <div className="message-list">
          {messages.length === 0 ? (
            <div className="chat-empty-state">
              <LiquidOrb />
              <span className="eyebrow">Citation-first assistant</span>
              <h2>Bạn muốn tìm hiểu điều gì?</h2>
              <p>
                Hỏi CampusIQ về học phí, học bổng, thư viện, đăng ký học phần
                hoặc dịch vụ hỗ trợ sinh viên.
              </p>
              <div className="empty-suggestions">
                {suggestions.map((prompt) => (
                  <button
                    key={prompt}
                    data-liquid-ripple
                    data-magnetic
                    type="button"
                    onClick={() => onSuggestion(prompt)}
                  >
                    <Sparkles size={14} /> {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <motion.div
                  key={message.id}
                  className="message-row user-row"
                  initial={{ opacity: 0, y: 12, filter: "blur(5px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="user-message" data-liquid-surface="micro">
                    <p>{message.content}</p>
                    <time>{message.timestamp}</time>
                  </div>
                  <div className="message-avatar user-avatar">
                    <UserRound size={16} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={message.id}
                  className="message-row assistant-row"
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="message-avatar assistant-avatar">
                    <Sparkles size={16} />
                  </div>
                  <div className={`assistant-message ${message.status === "error" ? "is-error" : ""}`} data-liquid-surface="micro">
                    <div className="assistant-label">
                      <span>CampusIQ</span>
                      <time>{message.timestamp}</time>
                    </div>
                    <AssistantContent content={message.content} messageId={message.id} onCitation={onCitation} />
                    {message.trace ? (
                      <div className="retrieval-trace">
                        <span className="trace-label">Trace</span>
                        {message.trace.steps.map((step) => (
                          <span key={step} className="trace-chip">
                            {step}
                          </span>
                        ))}
                        <span className="trace-latency">{message.trace.latency}</span>
                      </div>
                    ) : null}
                    {message.status !== "error" ? <div className="message-actions">
                      <button data-liquid-ripple type="button" onClick={() => void copyMessage(message)}>
                        {copiedMessageId === message.id ? (
                          <Check size={14} />
                        ) : (
                          <Clipboard size={14} />
                        )}
                        {copiedMessageId === message.id ? "Đã sao chép" : "Sao chép"}
                      </button>
                      <button
                        className={feedback[message.id] === "up" ? "is-selected" : ""}
                        data-liquid-ripple
                        type="button"
                        aria-label="Câu trả lời hữu ích"
                        onClick={() =>
                          setFeedback((current) => ({ ...current, [message.id]: "up" }))
                        }
                      >
                        <ThumbsUp size={14} /> Hữu ích
                      </button>
                      <button
                        className={feedback[message.id] === "down" ? "is-selected" : ""}
                        data-liquid-ripple
                        type="button"
                        aria-label="Câu trả lời không hữu ích"
                        onClick={() =>
                          setFeedback((current) => ({ ...current, [message.id]: "down" }))
                        }
                      >
                        <ThumbsDown size={14} /> Không hữu ích
                      </button>
                      <button
                        data-liquid-ripple
                        type="button"
                        onClick={() => onSuggestion(messages.at(-2)?.content ?? "")}
                      >
                        <RefreshCw size={14} /> Tạo lại
                      </button>
                    </div> : null}
                  </div>
                </motion.div>
              ),
            )
          )}
          {isLoading ? <LoadingMessage /> : null}
          <div ref={conversationEndRef} aria-hidden="true" />
        </div>
      </div>

      <div className="composer-dock">
        <div className="suggestion-row">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              data-liquid-ripple
              data-magnetic
              type="button"
              onClick={() => onSuggestion(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
        <form className="composer" data-liquid-surface="macro" onSubmit={submitForm}>
          <button
            className="composer-tool"
            data-liquid-ripple
            type="button"
            aria-label="Đính kèm tài liệu"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            rows={1}
            value={input}
            placeholder="Hỏi về học phí, học bổng, thư viện..."
            aria-label="Nhập câu hỏi"
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <TopKControl value={topK} onChange={onTopKChange} />
          <button
            className="send-button"
            data-liquid-ripple
            data-magnetic
            type="submit"
            disabled={!input.trim() || isLoading}
            aria-label="Gửi câu hỏi"
          >
            {isLoading ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}
          </button>
        </form>
        <p className="composer-hint">
          <CornerDownLeft size={12} /> Enter để gửi · Shift + Enter để xuống dòng
        </p>
      </div>
    </section>
  );
}
