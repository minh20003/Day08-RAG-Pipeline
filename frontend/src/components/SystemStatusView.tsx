import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Database,
  Globe2,
  Radio,
  RefreshCw,
  ServerCog,
  TimerReset,
} from "lucide-react";
import type { BackendSnapshot } from "../types";
import { CountUpValue } from "./CountUpValue";
import { LatencyRing } from "./charts/LatencyRing";

interface SystemStatusViewProps {
  backend: BackendSnapshot;
  onRefresh: () => void;
}

const componentLabels: Record<string, string> = {
  api: "FastAPI backend",
  chroma: "ChromaDB corpus",
  llm: "Generation provider",
  pageindex: "PageIndex fallback",
};

function formatTimestamp(value: string | null) {
  return value ? new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "Chưa kiểm tra";
}

export function SystemStatusView({ backend, onRefresh }: SystemStatusViewProps) {
  const components = Object.entries(backend.health?.components ?? {});
  const readyCount = components.filter(([, component]) => component.status === "ready").length;
  const readiness = components.length ? Math.round((readyCount / components.length) * 100) : 0;
  const totalChunks = backend.documents.reduce((total, document) => total + document.chunks, 0);
  const isRefreshing = backend.isRefreshing;
  const currentOrigin = window.location.origin;
  const isSecureOrigin = window.location.protocol === "https:";

  return (
    <section className="content-view system-view">
      <div className="system-overview" data-liquid-surface="macro">
        <div>
          <span className="eyebrow">Live integration readiness</span>
          <h2>{backend.status === "ready" ? "Pipeline RAG đã kết nối end-to-end" : "Đang theo dõi kết nối RAG"}</h2>
          <p>
            Trạng thái này được đọc trực tiếp từ health API và corpus hiện có. Không hiển thị trạng thái deploy hoặc service suy đoán.
          </p>
        </div>
        <div className="system-readiness-ring">
          <LatencyRing
            value={readiness / 100}
            size={102}
            stroke={10}
            label={<CountUpValue value={readiness} suffix="%" />}
            caption={`${readyCount}/${components.length} services`}
          />
        </div>
      </div>

      <div className="system-layout">
        <article className="view-card service-status-card" data-liquid-surface="macro">
          <div className="view-card-header">
            <div>
              <span className="eyebrow">Service health</span>
              <h2>Thành phần hệ thống</h2>
            </div>
            <button className="text-button" data-liquid-ripple type="button" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? "is-spinning" : ""} size={15} /> {isRefreshing ? "Đang kiểm tra" : "Làm mới"}
            </button>
          </div>
          {components.length ? (
            <div className="service-list">
              {components.map(([key, component]) => {
                const isReady = component.status === "ready";
                return (
                  <div key={key} className="service-row" data-liquid-surface="micro">
                    <div className={`service-icon ${isReady ? "online" : "waiting"}`}>
                      {key === "chroma" ? <Database size={18} /> : <ServerCog size={18} />}
                    </div>
                    <div className="service-copy">
                      <strong>{componentLabels[key] ?? key}</strong>
                      <span>{component.detail}</span>
                    </div>
                    <span className={`service-state ${isReady ? "online" : "waiting"}`}>
                      {isReady ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                      {isReady ? "Ready" : "Waiting"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="system-unavailable">
              <CircleAlert size={20} />
              <div><strong>Chưa đọc được health API</strong><p>{backend.error ?? "Kiểm tra lại kết nối backend rồi thử làm mới."}</p></div>
            </div>
          )}
        </article>

        <aside className="integration-cards">
          <article className="view-card integration-card" data-liquid-surface="micro">
            <div className="integration-heading"><Globe2 size={19} /><strong>Public origin</strong></div>
            <code>{currentOrigin}</code>
            <p>{isSecureOrigin ? "Kết nối hiện tại đang dùng HTTPS." : "Kết nối hiện tại không dùng HTTPS."}</p>
            <span className={`integration-status ${isSecureOrigin ? "safe" : "waiting"}`}>
              {isSecureOrigin ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
              {isSecureOrigin ? "Secure origin" : "Insecure origin"}
            </span>
          </article>
          <article className="view-card integration-card" data-liquid-surface="micro">
            <div className="integration-heading"><Database size={19} /><strong>Indexed corpus</strong></div>
            <p>{backend.documents.length} tài liệu, {totalChunks} chunks từ endpoint tài liệu thật.</p>
            <span className={`integration-status ${backend.documents.length ? "safe" : "waiting"}`}>
              <Activity size={13} /> {backend.documents.length ? "Corpus loaded" : "Chưa có corpus"}
            </span>
          </article>
          <article className="view-card integration-card" data-liquid-surface="micro">
            <div className="integration-heading"><TimerReset size={19} /><strong>Last health check</strong></div>
            <p>{formatTimestamp(backend.lastCheckedAt)}</p>
            <span className="integration-status neutral"><Radio size={13} />
              {backend.latencyMs === null ? "Chưa có latency" : `${backend.latencyMs}ms response`}
            </span>
          </article>
        </aside>
      </div>
    </section>
  );
}
