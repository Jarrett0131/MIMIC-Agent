import type { FormEvent, KeyboardEvent } from "react";
import { Suspense, lazy, useState } from "react";

import type {
  AnswerEvidenceLink,
  AskResponse,
  ConversationContext,
  ConversationTurn,
} from "../types";
import { getQuestionTypeLabel } from "../utils/labels";
import { LinkedAnswer } from "./LinkedAnswer";

// 懒加载 DevDebugPanel
const DevDebugPanel = lazy(() => import("./DevDebugPanel").then(mod => ({ default: mod.DevDebugPanel })));
import { AppCard } from "./ui/AppCard";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

interface ChatPanelProps {
  currentHadmId: number | null;
  patientLoading: boolean;
  question: string;
  submittedQuestion: string;
  askLoading: boolean;
  askError: string;
  askResult: AskResponse | null;
  conversationContext: ConversationContext;
  chatHistory?: ConversationTurn[];
  activeAnswerLinkId: string | null;
  onQuestionChange: (value: string) => void;
  onAnswerLinkHover: (link: AnswerEvidenceLink | null) => void;
  onAnswerLinkSelect: (link: AnswerEvidenceLink) => void;
  onSubmit: () => void | Promise<void>;
  onCancelAsk: () => void;
  onToggleImportPanel?: () => void;
  isImportPanelOpen?: boolean;
  debugRequests?: any[];
}

export function ChatPanel({
  currentHadmId,
  patientLoading,
  question,
  submittedQuestion,
  askLoading,
  askError,
  askResult,
  conversationContext,
  chatHistory = [],
  activeAnswerLinkId,
  onQuestionChange,
  onAnswerLinkHover,
  onAnswerLinkSelect,
  onSubmit,
  onCancelAsk,
  onToggleImportPanel,
  isImportPanelOpen = false,
  debugRequests = [],
}: ChatPanelProps) {
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  
  const toggleDebugPanel = () => {
    setShowDebugPanel((prev: boolean) => !prev);
  };
  const canSubmit =
    currentHadmId !== null &&
    question.trim().length > 0 &&
    !askLoading &&
    !patientLoading;
  const answerLinks = askResult?.answer_links ?? [];
  const latestTurn = chatHistory[chatHistory.length - 1] ?? null;
  const shouldRenderPendingQuestion =
    submittedQuestion.trim().length > 0 &&
    latestTurn?.question !== submittedQuestion;
  const shouldRenderLiveAnswer =
    (askLoading || askResult !== null) &&
    !(
      latestTurn &&
      ((askLoading && latestTurn.status === "streaming") ||
        (askResult &&
          latestTurn.response?.answer === askResult.answer &&
          latestTurn.response?.question_type === askResult.question_type &&
          latestTurn.status !== "failed" &&
          latestTurn.status !== "cancelled"))
    );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    void onSubmit();
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    void onSubmit();
  }

  return (
    <AppCard
      className="interaction-card"
      title="问答助手"
      subtitle="围绕当前入院记录提问，回答会尽量引用页面中的证据。"
      actions={
        <div className="interaction-actions">
          <StatusBadge tone={askLoading ? "warning" : "info"}>
            {askLoading ? "回答生成中" : "就绪"}
          </StatusBadge>
          {conversationContext.last_question_type && (
            <StatusBadge tone="neutral">
              {getQuestionTypeLabel(conversationContext.last_question_type)}
            </StatusBadge>
          )}
          {onToggleImportPanel && (
            <button
              className={`secondary-button ${isImportPanelOpen ? 'active' : ''}`}
              type="button"
              onClick={onToggleImportPanel}
              aria-expanded={isImportPanelOpen}
            >
              {isImportPanelOpen ? "收起导入" : "导入数据"}
            </button>
          )}
        </div>
      }
    >
      <div className="interaction-scroll-region">
        {askError && <div className="error-box">{askError}</div>}

        <div className="chat-stream">
          {currentHadmId === null ? (
            <EmptyState
              title="请先加载患者"
              description="在提问前请选择一个入院 ID。"
            />
          ) : (
            <>
              <article className="chat-message chat-message-system">
                <span className="chat-message-label">当前入院</span>
                已加载入院 <code>{currentHadmId}</code>
              </article>

              {chatHistory.map((turn) => (
                <div key={turn.id} className="chat-turn">
                  <article className="chat-message chat-message-user">
                    <span className="chat-message-label">问题</span>
                    <p className="chat-message-copy">{turn.question}</p>
                  </article>
                  {turn.response && (
                    <article className="chat-message chat-message-assistant chat-message-answer">
                      <div className="chat-answer-header">
                        <div>
                          <span className="chat-message-label">回答</span>
                          <p className="chat-answer-title">
                            {turn.response.question_type
                              ? getQuestionTypeLabel(turn.response.question_type)
                              : "回答"}
                          </p>
                        </div>
                        {turn.response.question_type && (
                          <StatusBadge tone={turn.response.success ? "success" : "error"}>
                            {getQuestionTypeLabel(turn.response.question_type)}
                          </StatusBadge>
                        )}
                      </div>
                      <LinkedAnswer
                        answer={turn.response.answer}
                        links={turn.response.answer_links ?? []}
                        activeLinkId={activeAnswerLinkId}
                        onHoverLink={onAnswerLinkHover}
                        onSelectLink={onAnswerLinkSelect}
                        isStreaming={false}
                      />
                    </article>
                  )}
                </div>
              ))}

              {shouldRenderPendingQuestion && (
                  <article className="chat-message chat-message-user">
                    <span className="chat-message-label">问题</span>
                    <p className="chat-message-copy">{submittedQuestion}</p>
                  </article>
                )}

              {shouldRenderLiveAnswer && (
                  <article className="chat-message chat-message-assistant chat-message-answer">
                    <div className="chat-answer-header">
                      <div>
                        <span className="chat-message-label">回答</span>
                        <p className="chat-answer-title">
                          {askResult?.question_type
                            ? getQuestionTypeLabel(askResult.question_type)
                            : "正在生成中"}
                        </p>
                      </div>
                      {askResult?.question_type && (
                        <StatusBadge tone={askResult.success ? "success" : "error"}>
                          {getQuestionTypeLabel(askResult.question_type)}
                        </StatusBadge>
                      )}
                    </div>
                    <LinkedAnswer
                      answer={askResult?.answer ?? ""}
                      links={answerLinks}
                      activeLinkId={activeAnswerLinkId}
                      onHoverLink={onAnswerLinkHover}
                      onSelectLink={onAnswerLinkSelect}
                      isStreaming={askLoading}
                    />
                  </article>
                )}
            </>
          )}
        </div>
      </div>

      <form className="command-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <label className="field-label" htmlFor="command-input">
            问题
          </label>
          <textarea
            id="command-input"
            className="command-input"
            rows={4}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={handleQuestionKeyDown}
            placeholder="例如：这个患者最新的乳酸结果是多少？"
            disabled={askLoading}
          />
        </div>

        <div className="query-actions">
          {import.meta.env.DEV && (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={toggleDebugPanel}
              >
                调试面板
              </button>
              {showDebugPanel && (
                <Suspense fallback={null}>
                  <DevDebugPanel
                    context={conversationContext}
                    isStreaming={askLoading}
                    requests={debugRequests}
                  />
                </Suspense>
              )}
            </>
          )}
          <button className="primary-button ask-button" type="submit" disabled={!canSubmit}>
            {askLoading ? "生成中..." : "发送"}
          </button>
          {askLoading && (
            <button className="secondary-button" type="button" onClick={onCancelAsk}>
              停止
            </button>
          )}
        </div>
      </form>
    </AppCard>
  );
}
