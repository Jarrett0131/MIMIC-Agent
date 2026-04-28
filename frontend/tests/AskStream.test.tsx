import { describe, expect, it, vi } from "vitest";

import { askQuestionStream } from "../src/api/ask";
import type { AskResponse, AskStreamEvent } from "../src/types";

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

function buildStreamResponse(contentType: string, chunks: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    {
      headers: {
        "content-type": contentType,
      },
    },
  );
}

function asNdjson(events: AskStreamEvent[]) {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

describe("askQuestionStream", () => {
  it("parses fragmented NDJSON stream chunks", async () => {
    const finalResponse = buildAskResponse("Hello");
    const streamText = asNdjson([
      {
        type: "answer_delta",
        delta: "Hel",
        answer: "Hel",
      },
      {
        type: "answer_delta",
        delta: "lo",
        answer: "Hello",
      },
      {
        type: "complete",
        response: finalResponse,
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      buildStreamResponse("application/x-ndjson; charset=utf-8", [
        streamText.slice(0, 17),
        streamText.slice(17),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onAnswerDelta = vi.fn();

    await expect(
      askQuestionStream(
        {
          hadm_id: 100001,
          question: "latest lactate",
        },
        { onAnswerDelta },
      ),
    ).resolves.toEqual(finalResponse);

    expect(onAnswerDelta).toHaveBeenCalledWith("Hello", "Hello");
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Accept).toContain(
      "text/event-stream",
    );
  });

  it("parses SSE data blocks", async () => {
    const finalResponse = buildAskResponse("OK");
    const sseText = [
      `data: ${JSON.stringify({
        type: "answer_delta",
        delta: "O",
        answer: "O",
      } satisfies AskStreamEvent)}\n\n`,
      `data: ${JSON.stringify({
        type: "answer_delta",
        delta: "K",
        answer: "OK",
      } satisfies AskStreamEvent)}\n\n`,
      `data: ${JSON.stringify({
        type: "complete",
        response: finalResponse,
      } satisfies AskStreamEvent)}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        buildStreamResponse("text/event-stream; charset=utf-8", [
          sseText.slice(0, 11),
          sseText.slice(11),
        ]),
      ),
    );
    const onAnswerDelta = vi.fn();

    await expect(
      askQuestionStream(
        {
          hadm_id: 100001,
          question: "latest lactate",
        },
        { onAnswerDelta },
      ),
    ).resolves.toEqual(finalResponse);

    expect(onAnswerDelta).toHaveBeenCalledWith("OK", "OK");
  });
});
