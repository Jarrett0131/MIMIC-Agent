import { AsyncLocalStorage } from "node:async_hooks";

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

export function runWithRequestContext<T>(
  requestId: string,
  callback: () => T,
): T {
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

export function recordRetryEvent(
  entry: Omit<RetryEvent, "created_at">,
): void {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.retries.push({
    ...entry,
    created_at: new Date().toISOString(),
  });
}

export function recordLlmCallEvent(
  entry: Omit<LlmCallEvent, "created_at">,
): void {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.llmCalls.push({
    ...entry,
    created_at: new Date().toISOString(),
  });
}
