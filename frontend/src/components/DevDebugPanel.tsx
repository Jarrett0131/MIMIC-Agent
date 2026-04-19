import type { ConversationContext, DebugRequestEntry } from "../types";
import { StatusBadge } from "./ui/StatusBadge";

type DevDebugPanelProps = {
  context: ConversationContext;
  isStreaming: boolean;
  requests: DebugRequestEntry[];
};

function formatDuration(durationMs: number | null): string {
  if (typeof durationMs !== "number") {
    return "-";
  }

  return `${Math.round(durationMs)} ms`;
}

function formatTokens(totalTokens: number | undefined): string {
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens)) {
    return "-";
  }

  return `${totalTokens} tokens`;
}

function getRequestTone(status: DebugRequestEntry["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "failed":
      return "error" as const;
    case "cancelled":
      return "warning" as const;
    default:
      return "info" as const;
  }
}

function getRequestStatusLabel(status: DebugRequestEntry["status"]): string {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "进行中";
  }
}

export function DevDebugPanel({
  context,
  isStreaming,
  requests,
}: DevDebugPanelProps) {
  const latestRequest = requests[0] ?? null;
  const latestRagTopResult = latestRequest?.diagnostics?.rag?.top_results[0] ?? null;

  return (
    <aside className="dev-debug-panel">
      <div className="dev-debug-body">
        <div className="dev-debug-section">
          <strong>当前上下文</strong>
          <p>hadm_id: {context.hadm_id ?? "-"}</p>
          <p>subject_id: {context.subject_id ?? "-"}</p>
          <p>last_question_type: {context.last_question_type ?? "-"}</p>
          <p>chat_history turns: {context.chat_history?.length ?? 0}</p>
          <p>流式返回: {String(isStreaming)}</p>
        </div>

        <div className="dev-debug-section">
          <strong>最近一次详情</strong>
          {!latestRequest ? (
            <p>暂时还没有请求记录。</p>
          ) : (
            <>
              <p>问题: {latestRequest.question}</p>
              <p>route: {latestRequest.routeType ?? "-"}</p>
              <p>route_family: {latestRequest.routeFamily ?? "-"}</p>
              <p>
                rewrite:{
                  latestRequest.diagnostics?.rewrite.changed
                    ? `${latestRequest.diagnostics.rewrite.source} -> ${latestRequest.diagnostics.rewrite.rewritten_question}`
                    : latestRequest.diagnostics?.rewrite.source ?? "-"
                }
              </p>
              <p>
                rewrite_guard:{
                  latestRequest.diagnostics?.rewrite.guard_applied
                    ? latestRequest.diagnostics.rewrite.guard_reason ?? "applied"
                    : "not applied"
                }
              </p>
              <p>
                rag:{
                  latestRequest.diagnostics?.rag
                    ? `${latestRequest.diagnostics.rag.matched ? "matched" : "miss"} via ${latestRequest.diagnostics.rag.retriever ?? "-"}`
                    : "-"
                }
              </p>
              <p>rag_top1: {latestRagTopResult?.title ?? "-"}</p>
              <p>rag_reason: {latestRequest.diagnostics?.rag?.reason ?? "-"}</p>
              <p>
                answer_enhancement:{
                  latestRequest.enhancement?.answer_enhancement?.applied
                    ? "applied"
                    : latestRequest.enhancement?.answer_enhancement?.fallback_reason ?? "not applied"
                }
              </p>
              <p>
                llm:{
                  latestRequest.diagnostics?.llm
                    ? `${latestRequest.diagnostics.llm.call_count} calls`
                    : "-"
                }
              </p>
              <p>llm_total: {formatTokens(latestRequest.diagnostics?.llm?.total_tokens)}</p>
              <p>
                llm_streamed:{
                  latestRequest.diagnostics?.llm
                    ? String(latestRequest.diagnostics.llm.streamed)
                    : "-"
                }
              </p>
              <p>
                llm_fallback:{
                  latestRequest.diagnostics?.llm
                    ? String(latestRequest.diagnostics.llm.fallback_used)
                    : "-"
                }
              </p>
              <p>
                llm_budget_exceeded:{
                  latestRequest.diagnostics?.llm
                    ? String(latestRequest.diagnostics.llm.budget_exceeded)
                    : "-"
                }
              </p>
              <p>
                error_code: {latestRequest.errorCode ?? latestRequest.diagnostics?.error_code ?? "-"}
              </p>
            </>
          )}
        </div>

        <div className="dev-debug-section">
          <strong>最近请求</strong>
          {requests.length === 0 ? (
            <p>暂时还没有请求记录。</p>
          ) : (
            <div className="dev-debug-request-list">
              {requests.map((request) => (
                <article key={request.id} className="dev-debug-request-item">
                  <div className="dev-debug-request-header">
                    <StatusBadge tone={getRequestTone(request.status)}>
                      {getRequestStatusLabel(request.status)}
                    </StatusBadge>
                    <span>{formatDuration(request.durationMs)}</span>
                  </div>
                  <p>{request.question}</p>
                  <p>question_type: {request.questionType ?? "-"}</p>
                  <p>route: {request.routeType ?? "-"}</p>
                  <p>tools: {request.toolNames.join(", ") || "-"}</p>
                  <p>rewrite_source: {request.diagnostics?.rewrite.source ?? "-"}</p>
                  <p>rag_top1: {request.diagnostics?.rag?.top_results[0]?.title ?? "-"}</p>
                  <p>llm_calls: {request.diagnostics?.llm?.call_count ?? 0}</p>
                  <p>success: {request.success === null ? "-" : String(request.success)}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
