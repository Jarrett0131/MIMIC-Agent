import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPanel } from "../src/components/ChatPanel";
import type { AskResponse } from "../src/types";

function buildAskResponse(answer: string): AskResponse {
  return {
    success: true,
    question_type: "lab_query",
    workflow_state: ["answering", "done"],
    answer,
    evidence: [],
    tool_trace: [],
    limitation: [],
    error: null,
    answer_links: [],
  };
}

function ChatPanelHarness({
  onSubmit,
}: {
  onSubmit: () => void | Promise<void>;
}) {
  const [question, setQuestion] = useState("");

  return (
    <ChatPanel
      currentHadmId={100001}
      patientLoading={false}
      question={question}
      submittedQuestion=""
      askLoading={false}
      askError=""
      askResult={null}
      conversationContext={{
        hadm_id: 100001,
        last_question_type: null,
      }}
      activeAnswerLinkId={null}
      onQuestionChange={setQuestion}
      onAnswerLinkHover={() => undefined}
      onAnswerLinkSelect={() => undefined}
      onSubmit={onSubmit}
      onCancelAsk={() => undefined}
    />
  );
}

describe("ChatPanel", () => {
  it("submits after the user enters a question", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatPanelHarness onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox"), "latest lactate lab result");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits when the user presses Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatPanelHarness onSubmit={onSubmit} />);

    await user.type(screen.getByRole("textbox"), "latest lactate lab result{enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Enter for multiline input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ChatPanelHarness onSubmit={onSubmit} />);

    await user.type(
      screen.getByRole("textbox"),
      "latest lactate{shift>}{enter}{/shift}lab result",
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "latest lactate\nlab result",
    );
  });

  it("does not render the active answer twice when history already contains the latest turn", () => {
    const answer = "最新 Lactate 结果为 3.2 mmol/L。";
    const streamedResponse = buildAskResponse(answer);
    const finalResponse = buildAskResponse(answer);

    render(
      <ChatPanel
        currentHadmId={100001}
        patientLoading={false}
        question=""
        submittedQuestion="latest lactate lab result"
        askLoading={false}
        askError=""
        askResult={finalResponse}
        conversationContext={{
          hadm_id: 100001,
          last_question_type: "lab_query",
        }}
        chatHistory={[
          {
            id: "turn-1",
            question: "latest lactate lab result",
            response: streamedResponse,
            status: "completed",
            error: "",
          },
        ]}
        activeAnswerLinkId={null}
        onQuestionChange={() => undefined}
        onAnswerLinkHover={() => undefined}
        onAnswerLinkSelect={() => undefined}
        onSubmit={() => undefined}
        onCancelAsk={() => undefined}
      />,
    );

    expect(screen.getAllByText(answer)).toHaveLength(1);
  });
});
