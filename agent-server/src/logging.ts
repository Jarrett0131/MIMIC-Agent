import { AsyncLocalStorage } from "node:async_hooks";

import type { AskPipelineDiagnostics, AskResponse } from "./types";

// ---------------------------------------------------------------------------
// Request-scoped context (merged from logging/requestContext.ts)
// ---------------------------------------------------------------------------

export type RetryEvent = {
  action: string;
  attempt: number;
  max_attempts: number;
  status?: number;
  message: string;
  created_at: string;
};

export type LlmUsageEvent = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: boolean;
};

export type LlmCallEvent = {
  operation: string;
  provider: string;
  model: string;
  attempts: number;
  streamed: boolean;
  fallback_used: boolean;
  duration_ms: number;
  output_chars: number;
  status: "success" | "failed" | "budget_rejected";
  usage: LlmUsageEvent;
  error_code?: string;
  error_message?: string;
  created_at: string;
};

type RequestContextStore = {
  requestId: string;
  retries: RetryEvent[];
  llmCalls: LlmCallEvent[];
};

const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(requestId: string, callback: () => T): T {
  return requestContextStorage.run(
    {
      requestId,
      retries: [],
      llmCalls: [],
    },
    callback,
  );
}

export function getRequestContext(): RequestContextStore | undefined {
  return requestContextStorage.getStore();
}

export function recordRetryEvent(entry: Omit<RetryEvent, "created_at">): void {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.retries.push({
    ...entry,
    created_at: new Date().toISOString(),
  });
}

export function recordLlmCallEvent(entry: Omit<LlmCallEvent, "created_at">): void {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.llmCalls.push({
    ...entry,
    created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Structured logging (merged from logging/logger.ts)
// ---------------------------------------------------------------------------

type StructuredLogPayload = Record<string, unknown>;

export function writeStructuredLog(
  event: string,
  payload: StructuredLogPayload = {},
): void {
  const requestContext = getRequestContext();

  console.log(
    JSON.stringify({
      event,
      request_id: payload.request_id ?? requestContext?.requestId,
      ...payload,
    }),
  );
}

// ---------------------------------------------------------------------------
// /ask audit log (merged from logging/askLogger.ts)
// ---------------------------------------------------------------------------

export type AskLog = {
  request_id: string;
  hadm_id: string;
  question: string;
  question_type?: string | null;
  route_type?: string | null;
  tool_trace: unknown[];
  total_duration_ms: number;
  success: boolean;
  error_code?: string;
  created_at: string;
  retry_count?: number;
  retries?: RetryEvent[];
  enhancement?: AskResponse["enhancement"];
  pipeline: AskPipelineDiagnostics;
};

type BuildAskLogEntryArgs = {
  requestId: string;
  hadmId: number | string;
  question: string;
  response: AskResponse;
  diagnostics: AskPipelineDiagnostics;
  totalDurationMs: number;
  createdAt: string;
};

export function buildAskLogEntry({
  requestId,
  hadmId,
  question,
  response,
  diagnostics,
  totalDurationMs,
  createdAt,
}: BuildAskLogEntryArgs): AskLog {
  const requestContext = getRequestContext();

  return {
    request_id: requestId,
    hadm_id: String(hadmId),
    question,
    question_type: response.question_type,
    route_type: response.routing?.route_type ?? null,
    tool_trace: response.tool_trace,
    total_duration_ms: totalDurationMs,
    success: response.success,
    error_code: response.error?.code,
    created_at: createdAt,
    retry_count: requestContext?.retries.length ?? 0,
    retries: requestContext?.retries ?? [],
    enhancement: response.enhancement,
    pipeline: diagnostics,
  };
}

export function logAskRequest(entry: AskLog): void {
  writeStructuredLog("ask.request", entry);
}
