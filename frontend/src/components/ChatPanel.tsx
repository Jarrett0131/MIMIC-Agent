import { useState, type FormEvent } from "react";
import type { AskResponse } from "../types";
import { askQuestion } from "../api/ask";
import { ApiError } from "../api/client";

interface ChatPanelProps {
  /** 与 AskRequest.hadm_id、后端路径参数一致 */
  hadm_id: number | null;
  onTrace: (trace: AskResponse | null) => void;
}

export function ChatPanel({ hadm_id, onTrace }: ChatPanelProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (hadm_id == null || Number.isNaN(hadm_id)) {
      setError("请先加载有效的 hadm_id。");
      onTrace(null);
      return;
    }
    const q = question.trim();
    if (!q) {
      setError("请输入问题。");
      onTrace(null);
      return;
    }
    setLoading(true);
    setAnswer(null);
    onTrace(null);
    try {
      const res = await askQuestion({ hadm_id, question: q });
      setAnswer(res.answer);
      onTrace(res);
    } catch (err) {
      onTrace(null);
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("请求失败。");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel panel--chat">
      <h2 className="panel__title">问答</h2>
      <form className="chat-form" onSubmit={handleSubmit}>
        <label className="label" htmlFor="question">
          问题
        </label>
        <textarea
          id="question"
          className="textarea"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="例如：最近24小时乳酸怎么样？"
          disabled={loading}
        />
        <button type="submit" className="btn" disabled={loading}>
          {loading ? "提交中…" : "发送"}
        </button>
      </form>
      {error && <div className="alert alert--error">{error}</div>}
      <div className="chat-answer">
        <h3 className="subhead">回答</h3>
        {answer == null && !error && (
          <p className="muted">提交问题后在此显示回答。</p>
        )}
        {answer != null && <pre className="answer-block">{answer}</pre>}
      </div>
    </section>
  );
}
