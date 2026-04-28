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

const ANSWER_FLUSH_INTERVAL_MS = 32;
const ANSWER_MAX_CHARS_PER_FLUSH = 24;

function parseStreamEventPayload(rawPayload: string): AskStreamEvent {
  const parsedPayload = JSON.parse(rawPayload) as unknown;
  if (!isAskStreamEvent(parsedPayload)) {
    throw new Error("agent-server returned an invalid stream event.");
  }

  return parsedPayload;
}

function drainNdjsonEvents(
  buffer: string,
  onEvent: (event: AskStreamEvent) => void,
): string {
  let nextBuffer = buffer;
  let newlineIndex = nextBuffer.indexOf("\n");

  while (newlineIndex >= 0) {
    const rawLine = nextBuffer.slice(0, newlineIndex).trim();
    nextBuffer = nextBuffer.slice(newlineIndex + 1);

    if (rawLine) {
      onEvent(parseStreamEventPayload(rawLine));
    }

    newlineIndex = nextBuffer.indexOf("\n");
  }

  return nextBuffer;
}

function parseSseBlock(rawBlock: string): string | null {
  const dataLines: string[] = [];

  for (const line of rawBlock.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    if (field !== "data") {
      continue;
    }

    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
    dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
  }

  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function drainSseEvents(
  buffer: string,
  onEvent: (event: AskStreamEvent) => void,
): string {
  let nextBuffer = buffer;
  let separatorMatch = nextBuffer.match(/\r?\n\r?\n/);

  while (separatorMatch?.index !== undefined) {
    const separatorStart = separatorMatch.index;
    const separatorEnd = separatorStart + separatorMatch[0].length;
    const rawBlock = nextBuffer.slice(0, separatorStart);
    nextBuffer = nextBuffer.slice(separatorEnd);

    const payload = parseSseBlock(rawBlock);
    if (payload && payload !== "[DONE]") {
      onEvent(parseStreamEventPayload(payload));
    }

    separatorMatch = nextBuffer.match(/\r?\n\r?\n/);
  }

  return nextBuffer;
}

function createAnswerDeltaFlusher(handlers: AskQuestionStreamHandlers) {
  let pendingChars: string[] = [];
  let renderedAnswer = "";
  let flushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function clearFlushTimer() {
    if (flushTimer !== null) {
      globalThis.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flushChunk(maxChars = ANSWER_MAX_CHARS_PER_FLUSH) {
    clearFlushTimer();
    if (pendingChars.length === 0) {
      return;
    }

    const delta = pendingChars.splice(0, maxChars).join("");
    renderedAnswer += delta;
    handlers.onAnswerDelta?.(delta, renderedAnswer);

    if (pendingChars.length > 0) {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null) {
      return;
    }

    flushTimer = globalThis.setTimeout(() => {
      flushChunk();
    }, ANSWER_FLUSH_INTERVAL_MS);
  }

  return {
    push(delta: string, answer: string) {
      pendingChars.push(...Array.from(delta));
      const answerChars = Array.from(answer);
      renderedAnswer = answerChars
        .slice(0, Math.max(0, answerChars.length - pendingChars.length))
        .join("");
      scheduleFlush();
    },
    flushAll() {
      while (pendingChars.length > 0) {
        flushChunk(Number.POSITIVE_INFINITY);
      }
    },
    dispose() {
      clearFlushTimer();
      pendingChars = [];
    },
  };
}

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
        Accept: "text/event-stream, application/x-ndjson, application/json",
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
  const isNdjsonStream = contentType.includes("application/x-ndjson");
  const isSseStream = contentType.includes("text/event-stream");
  if ((!isNdjsonStream && !isSseStream) || !response.body) {
    return parseAskResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const answerFlusher = createAnswerDeltaFlusher(handlers);
  let protocolBuffer = "";
  let finalResponse: AskResponse | null = null;
  const processEvent = (event: AskStreamEvent) => {
    if (event.type === "answer_delta") {
      answerFlusher.push(event.delta, event.answer);
      return;
    }

    const completedResponse = handleStreamEvent(event, handlers);
    if (completedResponse) {
      finalResponse = completedResponse;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      protocolBuffer += decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });

      protocolBuffer = isSseStream
        ? drainSseEvents(protocolBuffer, processEvent)
        : drainNdjsonEvents(protocolBuffer, processEvent);

      if (done) {
        break;
      }
    }

    const trailingPayload = protocolBuffer.trim();
    if (trailingPayload) {
      if (isSseStream) {
        const ssePayload = parseSseBlock(trailingPayload);
        if (ssePayload && ssePayload !== "[DONE]") {
          processEvent(parseStreamEventPayload(ssePayload));
        }
      } else {
        processEvent(parseStreamEventPayload(trailingPayload));
      }
    }

    answerFlusher.flushAll();

    if (finalResponse) {
      return finalResponse;
    }

    throw new Error("The streaming response ended before the final result arrived.");
  } finally {
    answerFlusher.dispose();
  }
}
