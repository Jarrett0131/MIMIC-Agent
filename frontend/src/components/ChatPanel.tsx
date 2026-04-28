import type { FormEvent, KeyboardEvent } from "react";
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";

import type {
  AnswerEvidenceLink,
  AskResponse,
  ConversationContext,
  ConversationTurn,
} from "../types";
import { getQuestionTypeLabel } from "../utils/labels";
import { LinkedAnswer } from "./LinkedAnswer";
import { AppCard } from "./ui/AppCard";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

const DevDebugPanel = lazy(() =>
  import("./DevDebugPanel").then((mod) => ({ default: mod.DevDebugPanel })),
);

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

type ChatMessageItem =
  | { kind: "system"; id: string; hadmId: number }
  | { kind: "user"; id: string; question: string }
  | {
      kind: "assistant";
      id: string;
      answer: string;
      links: AnswerEvidenceLink[];
      questionType: AskResponse["question_type"] | undefined;
      success: boolean;
      isStreaming: boolean;
    };

export const ChatPanel = memo(function ChatPanel({
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
  const [isAtBottom, setIsAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottomRef = useRef(true);

  const canSubmit =
    currentHadmId !== null &&
    question.trim().length > 0 &&
    !askLoading &&
    !patientLoading;
  const answerLinks = useMemo(() => askResult?.answer_links ?? [], [askResult]);
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

  const chatItems = useMemo<ChatMessageItem[]>(() => {
    if (currentHadmId === null) {
      return [];
    }

    const items: ChatMessageItem[] = [
      { kind: "system", id: `system-${currentHadmId}`, hadmId: currentHadmId },
    ];

    for (const turn of chatHistory) {
      items.push({
        kind: "user",
        id: `${turn.id}-question`,
        question: turn.question,
      });

      if (turn.response) {
        items.push({
          kind: "assistant",
          id: `${turn.id}-answer`,
          answer: turn.response.answer,
          links: turn.response.answer_links ?? [],
          questionType: turn.response.question_type,
          success: turn.response.success,
          isStreaming: false,
        });
      }
    }

    if (shouldRenderPendingQuestion) {
      items.push({
        kind: "user",
        id: "pending-question",
        question: submittedQuestion,
      });
    }

    if (shouldRenderLiveAnswer) {
      items.push({
        kind: "assistant",
        id: "live-answer",
        answer: askResult?.answer ?? "",
        links: answerLinks,
        questionType: askResult?.question_type,
        success: askResult?.success ?? false,
        isStreaming: askLoading,
      });
    }

    return items;
  }, [
    answerLinks,
    askLoading,
    askResult,
    chatHistory,
    currentHadmId,
    shouldRenderLiveAnswer,
    shouldRenderPendingQuestion,
    submittedQuestion,
  ]);
  const lastChatItemId = chatItems[chatItems.length - 1]?.id ?? null;
  const initialItemCount =
    import.meta.env.MODE === "test" ? chatItems.length : undefined;

  useEffect(() => {
    if (!lastChatItemId || !isAtBottomRef.current) {
      return;
    }

    virtuosoRef.current?.scrollToIndex({
      index: chatItems.length - 1,
      align: "end",
      behavior: "smooth",
    });
  }, [chatItems.length, lastChatItemId]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

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

  const renderChatItem = useCallback((item: ChatMessageItem) => {
    if (item.kind === "system") {
      return (
        <div className="chat-message-virtual-row">
          <article className="chat-message chat-message-system">
            <span className="chat-message-label">当前入院</span>
            已加载入院 <code>{item.hadmId}</code>
          </article>
        </div>
      );
    }

    if (item.kind === "user") {
      return (
        <div className="chat-message-virtual-row">
          <article className="chat-message chat-message-user">
            <span className="chat-message-label">问题</span>
            <p className="chat-message-copy">{item.question}</p>
          </article>
        </div>
      );
    }

    return (
      <div className="chat-message-virtual-row">
        <article className="chat-message chat-message-assistant chat-message-answer">
          <div className="chat-answer-header">
            <div>
              <span className="chat-message-label">回答</span>
              <p className="chat-answer-title">
                {item.questionType
                  ? getQuestionTypeLabel(item.questionType)
                  : item.isStreaming
                    ? "正在生成中"
                    : "回答"}
              </p>
            </div>
            {item.questionType && (
              <StatusBadge tone={item.success ? "success" : "error"}>
                {getQuestionTypeLabel(item.questionType)}
              </StatusBadge>
            )}
          </div>
          <LinkedAnswer
            answer={item.answer}
            links={item.links}
            activeLinkId={activeAnswerLinkId}
            onHoverLink={onAnswerLinkHover}
            onSelectLink={onAnswerLinkSelect}
            isStreaming={item.isStreaming}
          />
        </article>
      </div>
    );
  }, [activeAnswerLinkId, onAnswerLinkHover, onAnswerLinkSelect]);

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
              className={`secondary-button ${isImportPanelOpen ? "active" : ""}`}
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

        {currentHadmId === null ? (
          <EmptyState
            title="请先加载患者"
            description="在提问前请选择一个入院 ID。"
          />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="chat-stream"
            data={chatItems}
            computeItemKey={(_, item) => item.id}
            initialItemCount={initialItemCount}
            overscan={240}
            followOutput={isAtBottom ? "smooth" : false}
            atBottomStateChange={handleAtBottomStateChange}
            itemContent={(_, item) => renderChatItem(item)}
          />
        )}
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
                onClick={() => setShowDebugPanel((prev) => !prev)}
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
});
