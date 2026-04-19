import { appConfig } from "../config/app";
import type {
  AskRequest,
  AskResponse,
  AskStreamEvent,
  WorkflowStage,
} from "../types";
import {
  buildConnectionError,
  isAbortError,
  parseErrorMessage,
} from "./http";

function isAskResponse(value: unknown): value is AskResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.success === "boolean" &&
    Array.isArray(record.workflow_state) &&
    typeof record.answer === "string" &&
    Array.isArray(record.evidence) &&
    Array.isArray(record.tool_trace) &&
    Array.isArray(record.limitation) &&
    "error" in record
  );
}

function isWorkflowStage(value: unknown): value is WorkflowStage {
  return (
    value === "idle" ||
    value === "classifying" ||
    value === "tool_running" ||
    value === "answering" ||
    value === "done" ||
    value === "error"
  );
}

function isAskStreamEvent(value: unknown): value is AskStreamEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "workflow") {
    return Array.isArray(record.workflow_state) && isWorkflowStage(record.stage);
  }

  if (record.type === "meta" || record.type === "complete") {
    return isAskResponse(record.response);
  }

  if (record.type === "answer_delta") {
    return typeof record.delta === "string" && typeof record.answer === "string";
  }

  return false;
}

async function parseAskResponse(response: Response): Promise<AskResponse> {
  const text = await response.text();
  let parsedBody: unknown = null;

  if (text.trim()) {
    try {
      parsedBody = JSON.parse(text) as unknown;
    } catch {
      parsedBody = null;
    }
  }

  if (isAskResponse(parsedBody)) {
    return parsedBody;
  }

  if (!response.ok) {
    throw new Error(parseErrorMessage(text, response.status));
  }

  throw new Error("agent-server returned an unrecognized response payload.");
}

type AskQuestionStreamHandlers = {
  signal?: AbortSignal;
  onWorkflow?: (workflowState: WorkflowStage[]) => void;
  onMeta?: (response: AskResponse) => void;
  onAnswerDelta?: (delta: string, answer: string) => void;
};

function handleStreamEvent(
  event: AskStreamEvent,
  handlers: AskQuestionStreamHandlers,
): AskResponse | null {
  switch (event.type) {
    case "workflow":
      handlers.onWorkflow?.(event.workflow_state);
      return null;
    case "meta":
      handlers.onMeta?.(event.response);
      return null;
    case "answer_delta":
      handlers.onAnswerDelta?.(event.delta, event.answer);
      return null;
    case "complete":
      return event.response;
  }
}

export async function askQuestionStream(
  payload: AskRequest,
  handlers: AskQuestionStreamHandlers = {},
): Promise<AskResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/ask`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        stream: true,
      }),
      signal: handlers.signal,
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw error;
    }

    throw buildConnectionError();
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson") || !response.body) {
    return parseAskResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: AskResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (rawLine) {
        const parsedLine = JSON.parse(rawLine) as unknown;
        if (!isAskStreamEvent(parsedLine)) {
          throw new Error("agent-server returned an invalid stream event.");
        }

        const completedResponse = handleStreamEvent(parsedLine, handlers);
        if (completedResponse) {
          finalResponse = completedResponse;
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine) {
    const parsedLine = JSON.parse(trailingLine) as unknown;
    if (!isAskStreamEvent(parsedLine)) {
      throw new Error("agent-server returned an invalid stream event.");
    }

    const completedResponse = handleStreamEvent(parsedLine, handlers);
    if (completedResponse) {
      finalResponse = completedResponse;
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  throw new Error("The streaming response ended before the final result arrived.");
}
