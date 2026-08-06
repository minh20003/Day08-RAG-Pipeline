import {
  RagClientError,
  type HealthResponse,
  type RagClient,
  type RagQuery,
  type RagRequestOptions,
  type RagResponse,
  type RetrievalTrace,
  type SourceDocument,
} from "../types";

export { RagClientError } from "../types";

export const RAG_REQUEST_TIMEOUTS = {
  health: 10_000,
  documents: 10_000,
  chat: 120_000,
} as const;

type JsonRecord = Record<string, unknown>;

interface RequestConfig<T> extends RagRequestOptions {
  timeoutMs: number;
  validate: (value: unknown) => value is T;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSourceDocument(value: unknown): value is SourceDocument {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.category === "LEGAL" || value.category === "NEWS") &&
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    (value.method === "Hybrid" || value.method === "Semantic" || value.method === "BM25" || value.method === "PageIndex") &&
    typeof value.excerpt === "string" &&
    typeof value.content === "string" &&
    typeof value.year === "number" &&
    Number.isFinite(value.year) &&
    (value.url === undefined || value.url === null || typeof value.url === "string") &&
    typeof value.verified === "boolean" &&
    typeof value.chunks === "number" &&
    Number.isFinite(value.chunks) &&
    typeof value.indexedAt === "string"
  );
}

function isRetrievalTrace(value: unknown): value is RetrievalTrace {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.steps) &&
    typeof value.latency === "string" &&
    (value.mode === "hybrid" || value.mode === "pageindex" || value.mode === "none")
  );
}

function isRagResponse(value: unknown): value is RagResponse {
  if (!isRecord(value)) return false;
  return (
    typeof value.answer === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(isSourceDocument) &&
    isRetrievalTrace(value.trace)
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (!isRecord(value) || !isRecord(value.components)) return false;
  return (
    value.status === "ok" &&
    typeof value.service === "string" &&
    typeof value.version === "string" &&
    Object.values(value.components).every((component) => {
      if (!isRecord(component)) return false;
      return (
        (component.status === "ready" || component.status === "waiting") &&
        typeof component.detail === "string"
      );
    })
  );
}

function isSourceDocumentList(value: unknown): value is SourceDocument[] {
  return Array.isArray(value) && value.every(isSourceDocument);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function isRagClientError(error: unknown): error is RagClientError {
  return error instanceof RagClientError;
}

export class HttpRagClient implements RagClient {
  constructor(private readonly baseUrl: string) {}

  private endpoint(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    { signal, timeoutMs, validate }: RequestConfig<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();

    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    const timeoutId = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let removeAbortListener: () => void = () => {};
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectForAbort = () => {
        reject(
          timedOut
            ? new RagClientError("timeout", "RAG API mất quá lâu để phản hồi.")
            : new RagClientError("aborted", "Yêu cầu đến RAG API đã bị hủy."),
        );
      };

      if (controller.signal.aborted) {
        rejectForAbort();
        return;
      }
      controller.signal.addEventListener("abort", rejectForAbort, { once: true });
      removeAbortListener = () => controller.signal.removeEventListener("abort", rejectForAbort);
    });
    const awaitActive = <Value,>(promise: Promise<Value>) => Promise.race([promise, abortPromise]);
    const throwIfAborted = () => {
      if (controller.signal.aborted) throw new Error("Request aborted");
    };

    try {
      const response = await awaitActive(fetch(this.endpoint(path), { ...init, signal: controller.signal }));
      throwIfAborted();
      if (!response.ok) {
        throw new RagClientError("http", `RAG API trả về HTTP ${response.status}.`, response.status);
      }

      let payload: unknown;
      try {
        payload = await awaitActive(response.json());
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        throw new RagClientError("invalid-response", "RAG API trả về dữ liệu không phải JSON hợp lệ.", undefined, error);
      }
      throwIfAborted();

      if (!validate(payload)) {
        throw new RagClientError("invalid-response", "RAG API trả về dữ liệu không đúng định dạng mong đợi.");
      }
      throwIfAborted();
      return payload;
    } catch (error) {
      if (isRagClientError(error)) throw error;
      if (timedOut) {
        throw new RagClientError("timeout", "RAG API mất quá lâu để phản hồi.", undefined, error);
      }
      if (controller.signal.aborted || isAbortError(error)) {
        throw new RagClientError("aborted", "Yêu cầu đến RAG API đã bị hủy.", undefined, error);
      }
      throw new RagClientError("network", "Không thể kết nối đến RAG API.", undefined, error);
    } finally {
      globalThis.clearTimeout(timeoutId);
      removeAbortListener();
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  health(options?: RagRequestOptions): Promise<HealthResponse> {
    return this.request("/health", {}, {
      ...options,
      timeoutMs: RAG_REQUEST_TIMEOUTS.health,
      validate: isHealthResponse,
    });
  }

  listDocuments(options?: RagRequestOptions): Promise<SourceDocument[]> {
    return this.request("/api/documents", {}, {
      ...options,
      timeoutMs: RAG_REQUEST_TIMEOUTS.documents,
      validate: isSourceDocumentList,
    });
  }

  query(input: RagQuery, options?: RagRequestOptions): Promise<RagResponse> {
    return this.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        conversation_id: input.conversationId,
        top_k: input.topK,
        use_reranking: input.useReranking,
      }),
    }, {
      ...options,
      timeoutMs: RAG_REQUEST_TIMEOUTS.chat,
      validate: isRagResponse,
    });
  }
}

const configuredApiUrl = import.meta.env.VITE_RAG_API_URL?.trim();
const apiBaseUrl = configuredApiUrl === "same-origin" || !configuredApiUrl ? "" : configuredApiUrl;

/**
 * The frontend deliberately has no data fallback. Any unavailable API is shown
 * as a recoverable connection error in the UI instead of producing fake answers.
 */
export const ragClient: RagClient = new HttpRagClient(apiBaseUrl);
