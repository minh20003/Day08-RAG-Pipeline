import type { ChatMessage, ConversationSummary, StoredConversation } from "../types";

const STORAGE_KEY = "campusiq:conversations:v1";
const MAX_CONVERSATIONS = 12;
const TITLE_LIMIT = 48;

function isSourceDocument(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const source = value as { id?: unknown; title?: unknown };
  return typeof source.id === "string" && typeof source.title === "string";
}

function isRetrievalTrace(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const trace = value as { steps?: unknown; latency?: unknown; mode?: unknown };
  return (
    Array.isArray(trace.steps) &&
    trace.steps.every((step) => typeof step === "string") &&
    typeof trace.latency === "string" &&
    (trace.mode === "hybrid" || trace.mode === "pageindex" || trace.mode === "none")
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  const basicShape =
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.timestamp === "string" &&
    typeof message.timestampIso === "string" &&
    Number.isFinite(Date.parse(message.timestampIso));
  const validStatus =
    message.status === undefined ||
    message.status === "success" ||
    message.status === "error" ||
    message.status === "cancelled";
  const validSourceIds =
    message.sourceIds === undefined ||
    (Array.isArray(message.sourceIds) && message.sourceIds.every((sourceId) => typeof sourceId === "string"));
  const validSources = message.sources === undefined || (Array.isArray(message.sources) && message.sources.every(isSourceDocument));
  const validTrace = message.trace === undefined || isRetrievalTrace(message.trace);
  return basicShape && validStatus && validSourceIds && validSources && validTrace;
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as Partial<StoredConversation>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    conversation.title.trim().length > 0 &&
    typeof conversation.updatedAt === "string" &&
    Number.isFinite(Date.parse(conversation.updatedAt)) &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isChatMessage)
  );
}

function trimTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > TITLE_LIMIT
    ? `${normalized.slice(0, TITLE_LIMIT - 1).trimEnd()}…`
    : normalized;
}

function sortConversations(conversations: StoredConversation[]) {
  return [...conversations].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

export function loadStoredConversations(): StoredConversation[] {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return [];
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];
    return sortConversations(parsedValue.filter(isStoredConversation)).slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

export function saveStoredConversations(conversations: StoredConversation[]) {
  const normalized = sortConversations(conversations).slice(0, MAX_CONVERSATIONS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // History is a convenience feature. The active conversation must keep working
    // when storage is disabled or the quota is full.
  }
  return normalized;
}

export function upsertStoredConversation(
  conversations: StoredConversation[],
  input: { id: string; messages: ChatMessage[]; updatedAt: string },
) {
  const firstQuestion = input.messages.find((message) => message.role === "user")?.content;
  if (!firstQuestion) return conversations;

  const previous = conversations.find((conversation) => conversation.id === input.id);
  const nextConversation: StoredConversation = {
    id: input.id,
    title: previous?.title || trimTitle(firstQuestion),
    updatedAt: input.updatedAt,
    messages: input.messages,
  };
  return saveStoredConversations([
    nextConversation,
    ...conversations.filter((conversation) => conversation.id !== input.id),
  ]);
}

export function toConversationSummaries(conversations: StoredConversation[]): ConversationSummary[] {
  const formatter = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  const now = Date.now();
  return sortConversations(conversations).map((conversation) => {
    const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(conversation.updatedAt)) / 60_000));
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const elapsedDays = Math.floor(elapsedHours / 24);
    const time =
      elapsedMinutes < 60
        ? formatter.format(-elapsedMinutes, "minute")
        : elapsedHours < 24
          ? formatter.format(-elapsedHours, "hour")
          : formatter.format(-elapsedDays, "day");
    return { id: conversation.id, title: conversation.title, time };
  });
}
