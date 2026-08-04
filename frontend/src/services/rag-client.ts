import type {
  HealthResponse,
  RagClient,
  RagQuery,
  RagResponse,
  SourceDocument,
} from "../types";

class HttpRagClient implements RagClient {
  constructor(private readonly baseUrl: string) {}

  private endpoint(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.endpoint(path), init);
    if (!response.ok) {
      throw new Error(`RAG API trả về HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  listDocuments(): Promise<SourceDocument[]> {
    return this.request<SourceDocument[]>("/api/documents");
  }

  query(input: RagQuery): Promise<RagResponse> {
    return this.request<RagResponse>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        conversation_id: input.conversationId,
        top_k: input.topK,
        use_reranking: input.useReranking,
      }),
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
