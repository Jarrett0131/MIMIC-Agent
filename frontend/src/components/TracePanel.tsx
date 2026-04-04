import type { AskResponse, JsonObject } from "../types";

interface TracePanelProps {
  trace: AskResponse | null;
}

function stringifyEvidence(rows: JsonObject[]): string {
  try {
    return JSON.stringify(rows, null, 2);
  } catch {
    return String(rows);
  }
}

export function TracePanel({ trace }: TracePanelProps) {
  return (
    <section className="panel panel--trace">
      <h2 className="panel__title">追踪 / 证据</h2>
      {!trace && <p className="muted">发送问题后将显示路由与证据。</p>}
      {trace && (
        <div className="trace-body">
          <dl className="kv">
            <dt>question_type</dt>
            <dd>
              <code>{trace.question_type}</code>
            </dd>
            <dt>tool_called</dt>
            <dd>
              <code>{trace.tool_called}</code>
            </dd>
          </dl>
          <h3 className="subhead">tool_args</h3>
          <pre className="code-block">
            {JSON.stringify(trace.tool_args, null, 2)}
          </pre>
          <h3 className="subhead">evidence</h3>
          <pre className="code-block code-block--scroll">
            {stringifyEvidence(trace.evidence)}
          </pre>
          <h3 className="subhead">limitation</h3>
          <p className="limitation">{trace.limitation}</p>
        </div>
      )}
    </section>
  );
}
