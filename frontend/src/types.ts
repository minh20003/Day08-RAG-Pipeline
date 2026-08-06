export type ViewId = "assistant" | "library" | "evaluation" | "system";
export type ThemeMode = "light" | "dark";
export type MessageRole = "user" | "assistant";
export type DocumentCategory = "LEGAL" | "NEWS";
export type RetrievalMethod = "Hybrid" | "Semantic" | "BM25" | "PageIndex";
export type RagClientErrorCode = "timeout" | "aborted" | "network" | "http" | "invalid-response";

export interface SourceDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  score: number;
  method: RetrievalMethod;
  excerpt: string;
  content: string;
  year: number;
  url?: string | null;
  verified: boolean;
  chunks: number;
  indexedAt: string;
}

export interface RetrievalTrace {
  steps: string[];
  latency: string;
  mode: "hybrid" | "pageindex" | "none";
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  sourceIds?: string[];
  /** The exact evidence returned with this answer, kept for citations and history. */
  sources?: SourceDocument[];
  trace?: RetrievalTrace;
  timestamp: string;
  timestampIso: string;
  status?: "success" | "error" | "cancelled";
}

export interface ConversationSummary {
  id: string;
  title: string;
  time: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export type BackendStatus = "loading" | "ready" | "degraded" | "offline";

export interface BackendSnapshot {
  status: BackendStatus;
  isRefreshing: boolean;
  health: HealthResponse | null;
  documents: SourceDocument[];
  lastCheckedAt: string | null;
  latencyMs: number | null;
  error: string | null;
}

export interface RagQuery {
  message: string;
  conversationId: string;
  topK: number;
  useReranking: boolean;
}

export interface RagResponse {
  answer: string;
  sources: SourceDocument[];
  trace: RetrievalTrace;
}

export interface RagRequestOptions {
  signal?: AbortSignal;
}

export class RagClientError extends Error {
  readonly name = "RagClientError";

  constructor(
    readonly code: RagClientErrorCode,
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface ComponentHealth {
  status: 'ready' | 'waiting';
  detail: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  components: Record<string, ComponentHealth>;
}

export interface RagClient {
  query(input: RagQuery, options?: RagRequestOptions): Promise<RagResponse>;
  health(options?: RagRequestOptions): Promise<HealthResponse>;
  listDocuments(options?: RagRequestOptions): Promise<SourceDocument[]>;
}
