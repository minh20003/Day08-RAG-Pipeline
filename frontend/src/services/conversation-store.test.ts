import { describe, expect, it, vi } from "vitest";
import type { StoredConversation } from "../types";
import { toConversationSummaries } from "./conversation-store";

function conversation(updatedAt: string): StoredConversation {
  return {
    id: updatedAt,
    title: "Học phí",
    updatedAt,
    messages: [
      {
        id: "question",
        role: "user",
        content: "Học phí là bao nhiêu?",
        timestamp: "10:00",
        timestampIso: updatedAt,
      },
    ],
  };
}

describe("toConversationSummaries", () => {
  it("uses minute, hour, and day labels for past conversations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));

    const summaries = toConversationSummaries([
      conversation("2026-08-06T11:55:00.000Z"),
      conversation("2026-08-06T09:00:00.000Z"),
      conversation("2026-08-03T12:00:00.000Z"),
    ]);

    expect(summaries.map((item) => item.time)).toEqual([
      "5 phút trước",
      "3 giờ trước",
      "3 ngày trước",
    ]);
    vi.useRealTimers();
  });
});
