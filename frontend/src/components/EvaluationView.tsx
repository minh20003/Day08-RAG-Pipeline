import { useMemo } from "react";
import {
  BarChart3,
  Clock3,
  FileText,
  Gauge,
  Layers3,
  Quote,
  Route,
  Sparkles,
} from "lucide-react";
import type { BackendSnapshot, ChatMessage, StoredConversation } from "../types";
import { CountUpValue } from "./CountUpValue";
import { LatencyRing } from "./charts/LatencyRing";
import { MetricBar } from "./charts/MetricBar";

interface EvaluationViewProps {
  backend: BackendSnapshot;
  conversations: StoredConversation[];
}

interface QueryRun {
  id: string;
  question: string;
  timestamp: string;
  latencySeconds: number | null;
  mode: "hybrid" | "pageindex" | "none";
  sourceCount: number;
  status: "success" | "error";
}

const MODE_LABELS = {
  hybrid: "Hybrid",
  pageindex: "PageIndex",
  none: "No evidence",
} as const;

function parseLatency(latency: string | undefined) {
  const match = latency?.match(/(\d+(?:\.\d+)?)\s*s/i);
  return match ? Number(match[1]) : null;
}

function getQueryRuns(conversations: StoredConversation[]): QueryRun[] {
  const runs: QueryRun[] = [];
  for (const conversation of conversations) {
    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index];
      if (message.role !== "assistant" || !message.trace) continue;
      const previousQuestion = [...conversation.messages.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.role === "user");
      if (!previousQuestion) continue;
      runs.push({
        id: message.id,
        question: previousQuestion.content,
        timestamp: message.timestampIso,
        latencySeconds: parseLatency(message.trace.latency),
        mode: message.trace.mode,
        sourceCount: message.sources?.length ?? message.sourceIds?.length ?? 0,
        status: message.status === "error" ? "error" : "success",
      });
    }
  }
  return [...runs].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function getLastSourceMessages(conversations: StoredConversation[]) {
  return conversations.flatMap((conversation) =>
    conversation.messages.filter(
      (message): message is ChatMessage & { sources: NonNullable<ChatMessage["sources"]> } =>
        message.role === "assistant" && message.status !== "error" && Boolean(message.sources?.length),
    ),
  );
}

export function EvaluationView({ backend, conversations }: EvaluationViewProps) {
  const analytics = useMemo(() => {
    const runs = getQueryRuns(conversations);
    const successfulRuns = runs.filter((run) => run.status === "success");
    const citedRuns = successfulRuns.filter((run) => run.sourceCount > 0);
    const latencyValues = successfulRuns
      .map((run) => run.latencySeconds)
      .filter((value): value is number => value !== null);
    const sourceFrequency = new Map<string, number>();
    for (const message of getLastSourceMessages(conversations)) {
      for (const source of message.sources) {
        sourceFrequency.set(source.title, (sourceFrequency.get(source.title) ?? 0) + 1);
      }
    }
    const retrievalModes = (Object.keys(MODE_LABELS) as Array<keyof typeof MODE_LABELS>).map((mode) => ({
      mode,
      label: MODE_LABELS[mode],
      count: successfulRuns.filter((run) => run.mode === mode).length,
    }));
    return {
      runs,
      successfulRuns,
      citationRate: successfulRuns.length ? citedRuns.length / successfulRuns.length : 0,
      averageLatency: latencyValues.length
        ? latencyValues.reduce((total, value) => total + value, 0) / latencyValues.length
        : null,
      retrievalModes,
      popularSources: Array.from(sourceFrequency.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4),
    };
  }, [conversations]);

  const legalDocuments = backend.documents.filter((document) => document.category === "LEGAL").length;
  const newsDocuments = backend.documents.filter((document) => document.category === "NEWS").length;
  const totalChunks = backend.documents.reduce((total, document) => total + document.chunks, 0);
  const hasQueryData = analytics.runs.length > 0;

  return (
    <section className="content-view analytics-view">
      <div className="analytics-hero" data-liquid-surface="macro">
        <div>
          <span className="eyebrow">Live RAG Analytics</span>
          <h2>Quan sát corpus và các lần truy vấn thật</h2>
          <p>
            Dữ liệu được tổng hợp từ corpus ChromaDB, health API và lịch sử sử dụng trên thiết bị này.
            Không sử dụng điểm benchmark hoặc case study dựng sẵn.
          </p>
        </div>
        <div className={`analytics-connection analytics-connection--${backend.status}`}>
          <LatencyRing
            value={backend.status === "ready" ? Math.min(backend.latencyMs ?? 0, 2000) / 2000 : 0}
            size={56}
            stroke={5}
            label={backend.latencyMs !== null ? `${backend.latencyMs}` : "—"}
            caption="ms"
          />
          <div>
            <strong>{backend.status === "ready" ? "Live connection" : "Connection attention"}</strong>
            <span>{backend.lastCheckedAt ? `Cập nhật ${new Date(backend.lastCheckedAt).toLocaleTimeString("vi-VN")}` : "Đang chờ kiểm tra"}</span>
          </div>
        </div>
      </div>

      <div className="summary-grid analytics-summary">
        <article className="summary-card accent-card" data-liquid-surface="micro">
          <span>Corpus documents</span>
          <strong><CountUpValue value={backend.documents.length} /></strong>
          <p>{legalDocuments} legal · {newsDocuments} news</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>Indexed chunks</span>
          <strong><CountUpValue value={totalChunks} /></strong>
          <p>Đọc trực tiếp từ ChromaDB</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>Real queries</span>
          <strong><CountUpValue value={analytics.runs.length} /></strong>
          <p>{analytics.successfulRuns.length} phản hồi hoàn tất</p>
        </article>
        <article className="summary-card" data-liquid-surface="micro">
          <span>Evidence coverage</span>
          <strong><CountUpValue value={analytics.citationRate * 100} decimals={0} suffix="%" /></strong>
          <p>Tỷ lệ trả lời có nguồn trích dẫn</p>
        </article>
      </div>

      {hasQueryData ? (
        <div className="analytics-grid">
          <article className="view-card analytics-modes-card" data-liquid-surface="macro">
            <div className="view-card-header">
              <div>
                <span className="eyebrow">Retrieval telemetry</span>
                <h2>Đường đi truy xuất thực tế</h2>
              </div>
              <span className="analytics-latency"><Clock3 size={15} />
                {analytics.averageLatency === null ? "Chưa có latency" : `${analytics.averageLatency.toFixed(2)}s trung bình`}
              </span>
            </div>
            <div className="analytics-mode-list">
              {analytics.retrievalModes.map(({ mode, label, count }) => {
                const ratio = analytics.successfulRuns.length ? count / analytics.successfulRuns.length : 0;
                return (
                  <div className="analytics-mode-row" key={mode}>
                    <div><Route size={16} /><strong>{label}</strong></div>
                    <div className="analytics-mode-track"><MetricBar value={ratio} /></div>
                    <b>{count}</b>
                  </div>
                );
              })}
            </div>
          </article>

          <aside className="analytics-source-column">
            <article className="view-card analytics-source-card" data-liquid-surface="micro">
              <div className="analytics-card-heading"><Quote size={18} /><strong>Nguồn được dùng nhiều</strong></div>
              {analytics.popularSources.length ? (
                <ol className="analytics-source-list">
                  {analytics.popularSources.map(([title, uses]) => <li key={title}><span>{title}</span><b>{uses}×</b></li>)}
                </ol>
              ) : <p>Chưa có nguồn nào được trích dẫn.</p>}
            </article>
            <article className="view-card analytics-source-card" data-liquid-surface="micro">
              <div className="analytics-card-heading"><Layers3 size={18} /><strong>Corpus split</strong></div>
              <p>{legalDocuments} tài liệu chính sách và {newsDocuments} tin tức/hướng dẫn đang sẵn sàng truy xuất.</p>
            </article>
          </aside>
        </div>
      ) : (
        <article className="view-card analytics-empty" data-liquid-surface="macro">
          <div className="analytics-empty-icon"><Sparkles size={21} /></div>
          <div>
            <span className="eyebrow">No query telemetry yet</span>
            <h2>Chưa có truy vấn thật để phân tích</h2>
            <p>Hãy gửi câu hỏi trong Trợ lý AI. Các trace, nguồn trích dẫn và latency thực tế sẽ xuất hiện tại đây.</p>
          </div>
        </article>
      )}

      {hasQueryData ? (
        <article className="view-card analytics-runs-card" data-liquid-surface="macro">
          <div className="view-card-header">
            <div>
              <span className="eyebrow">Recent real runs</span>
              <h2>Các lần chạy gần đây</h2>
            </div>
            <span className="analytics-run-count"><BarChart3 size={15} /> {analytics.runs.length} lượt</span>
          </div>
          <div className="analytics-runs-table">
            {analytics.runs.slice(0, 8).map((run) => (
              <div className="analytics-run" key={run.id}>
                <div><FileText size={16} /><strong>{run.question}</strong></div>
                <span className={`analytics-mode-pill analytics-mode-pill--${run.mode}`}>{MODE_LABELS[run.mode]}</span>
                <span>{run.latencySeconds === null ? "—" : `${run.latencySeconds.toFixed(2)}s`}</span>
                <span>{run.sourceCount} nguồn</span>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
