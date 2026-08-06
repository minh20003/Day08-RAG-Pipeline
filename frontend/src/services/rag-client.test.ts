import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRagClient } from "./rag-client";

const client = new HttpRagClient("http://rag.test");

function abortablePendingResponse(signal: AbortSignal | null | undefined) {
  return new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("HttpRagClient", () => {
  it("maps its health timeout to a typed timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => abortablePendingResponse(init?.signal)));

    const request = client.health();
    const assertion = expect(request).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
  });

  it("maps a caller abort to an aborted error", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => abortablePendingResponse(init?.signal)));
    const controller = new AbortController();
    const request = client.listDocuments({ signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects malformed and HTTP API payloads without updating callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 42 }),
    }));

    await expect(client.query({
      message: "Tóm tắt tài liệu",
      conversationId: "conversation",
      topK: 5,
      useReranking: true,
    })).rejects.toMatchObject({ code: "invalid-response" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(client.health()).rejects.toMatchObject({ code: "http", status: 503 });
  });

  it("maps a transport failure to a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(client.health()).rejects.toMatchObject({ code: "network" });
  });
});
