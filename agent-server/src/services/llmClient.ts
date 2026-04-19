import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_ENABLED,
  LLM_FALLBACK_PROVIDERS,
  LLM_MAX_TOTAL_TOKENS,
  LLM_MODEL,
  LLM_PROVIDER,
  LLM_RETRY_TIMES,
  LLM_TIMEOUT_MS,
} from "../config";
import { writeStructuredLog } from "../logging/logger";
import { recordLlmCallEvent } from "../logging/requestContext";

type LlmRole = "system" | "user" | "assistant";
type SupportedLlmProvider = "aliyun" | "deepseek" | "openai";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: boolean;
};

export type LlmAvailability = {
  enabled: boolean;
  provider: string;
  model: string;
  timeout_ms: number;
  retry_times: number;
  fallback_providers: string[];
  budget_limit_tokens?: number;
  reason?: string;
};

export type LlmTextResult = {
  text: string;
  provider: string;
  model: string;
  attempt_count: number;
  fallback_used: boolean;
  streamed: boolean;
  usage: LlmUsage;
};

export type LlmRequestOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  operation?: string;
  jsonSchemaRetryTimes?: number;
};

export type LlmJsonSchema<T> = {
  name: string;
  description?: string;
  validate: (value: unknown) => value is T;
};

export type LlmStreamHandlers = {
  onDelta?: (delta: string, answer: string) => Promise<void> | void;
};

const DEFAULT_JSON_SCHEMA_RETRY_TIMES = 1;
const DEFAULT_TOP_P = 1;

type OpenAiCompatibleUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAiCompatibleChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: OpenAiCompatibleUsage;
  error?: {
    message?: string;
    code?: string;
  };
};

type OpenAiCompatibleChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAiCompatibleUsage;
  error?: {
    message?: string;
    code?: string;
  };
};

type OpenAiCompatibleChatCompletionRequest = {
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  messages: LlmMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
};

type ResolvedProviderConfig = {
  provider: SupportedLlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
};

function resolveDefaultLlmBaseUrl(provider: SupportedLlmProvider): string {
  if (provider === "aliyun") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }

  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }

  return "https://api.openai.com/v1";
}

function resolveDefaultLlmModel(provider: SupportedLlmProvider): string {
  if (provider === "aliyun") {
    return "qwen-plus";
  }

  if (provider === "deepseek") {
    return "deepseek-chat";
  }

  return "gpt-4.1-mini";
}

function isSupportedProvider(provider: string): provider is SupportedLlmProvider {
  return provider === "aliyun" || provider === "deepseek" || provider === "openai";
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function resolveProviderApiKey(provider: SupportedLlmProvider): string {
  if (provider === LLM_PROVIDER && LLM_API_KEY) {
    return LLM_API_KEY;
  }

  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_API_KEY");
  }

  if (provider === "aliyun") {
    return readEnv("DASHSCOPE_API_KEY");
  }

  return readEnv("OPENAI_API_KEY");
}

function resolveProviderModel(provider: SupportedLlmProvider): string {
  if (provider === LLM_PROVIDER && LLM_MODEL) {
    return LLM_MODEL;
  }

  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_MODEL") || resolveDefaultLlmModel(provider);
  }

  if (provider === "aliyun") {
    return (
      readEnv("ALIYUN_MODEL") ||
      readEnv("QWEN_MODEL") ||
      resolveDefaultLlmModel(provider)
    );
  }

  return readEnv("OPENAI_MODEL") || resolveDefaultLlmModel(provider);
}

function resolveProviderBaseUrl(provider: SupportedLlmProvider): string {
  if (provider === LLM_PROVIDER && LLM_BASE_URL) {
    return LLM_BASE_URL;
  }

  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_BASE_URL") || resolveDefaultLlmBaseUrl(provider);
  }

  if (provider === "aliyun") {
    return (
      readEnv("ALIYUN_BASE_URL") ||
      readEnv("DASHSCOPE_BASE_URL") ||
      resolveDefaultLlmBaseUrl(provider)
    );
  }

  return readEnv("OPENAI_BASE_URL") || resolveDefaultLlmBaseUrl(provider);
}

function resolveProviderConfig(provider: SupportedLlmProvider): ResolvedProviderConfig | null {
  const apiKey = resolveProviderApiKey(provider);
  const model = resolveProviderModel(provider);
  const baseUrl = resolveProviderBaseUrl(provider);

  if (!apiKey || !model || !baseUrl) {
    return null;
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl,
  };
}

function getProviderConfigs(): ResolvedProviderConfig[] {
  const orderedProviders = [
    LLM_PROVIDER,
    ...LLM_FALLBACK_PROVIDERS,
  ].filter((provider, index, values) => values.indexOf(provider) === index);

  return orderedProviders
    .filter(isSupportedProvider)
    .map((provider) => resolveProviderConfig(provider))
    .filter((config): config is ResolvedProviderConfig => config !== null);
}

function getAvailability(): LlmAvailability {
  if (!LLM_ENABLED) {
    return {
      enabled: false,
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      timeout_ms: LLM_TIMEOUT_MS,
      retry_times: LLM_RETRY_TIMES,
      fallback_providers: [],
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || undefined,
      reason: "LLM is disabled by configuration.",
    };
  }

  if (!isSupportedProvider(LLM_PROVIDER)) {
    return {
      enabled: false,
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      timeout_ms: LLM_TIMEOUT_MS,
      retry_times: LLM_RETRY_TIMES,
      fallback_providers: [],
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || undefined,
      reason: `Unsupported LLM provider "${LLM_PROVIDER}".`,
    };
  }

  const providerConfigs = getProviderConfigs();
  if (providerConfigs.length === 0) {
    return {
      enabled: false,
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      timeout_ms: LLM_TIMEOUT_MS,
      retry_times: LLM_RETRY_TIMES,
      fallback_providers: [],
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || undefined,
      reason: "No configured LLM provider has a usable API key and model.",
    };
  }

  return {
    enabled: true,
    provider: LLM_PROVIDER,
    model: LLM_MODEL,
    timeout_ms: LLM_TIMEOUT_MS,
    retry_times: LLM_RETRY_TIMES,
    fallback_providers: providerConfigs
      .slice(1)
      .map((config) => config.provider),
    budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || undefined,
  };
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function getContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return "";
      }

      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("\n")
    .trim();
}

function getDeltaText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return "";
      }

      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil([...normalized].length / 4));
}

function estimatePromptTokens(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => {
    return total + estimateTokenCount(message.role) + estimateTokenCount(message.content) + 4;
  }, 0);
}

function normalizeUsage(
  usage: OpenAiCompatibleUsage | undefined,
  messages: LlmMessage[],
  completionText: string,
): LlmUsage {
  const promptTokens = usage?.prompt_tokens ?? estimatePromptTokens(messages);
  const completionTokens = usage?.completion_tokens ?? estimateTokenCount(completionText);
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated:
      usage?.prompt_tokens === undefined ||
      usage?.completion_tokens === undefined ||
      usage?.total_tokens === undefined,
  };
}

function logLlmRequest(
  event: string,
  payload: Record<string, unknown>,
  provider?: ResolvedProviderConfig,
): void {
  writeStructuredLog(event, {
    provider: provider?.provider ?? LLM_PROVIDER,
    model: provider?.model ?? LLM_MODEL,
    timeout_ms: LLM_TIMEOUT_MS,
    retry_times: LLM_RETRY_TIMES,
    fallback_providers: LLM_FALLBACK_PROVIDERS,
    budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || undefined,
    ...payload,
    created_at: new Date().toISOString(),
  });
}

function buildRequestBody(
  provider: ResolvedProviderConfig,
  messages: LlmMessage[],
  options?: LlmRequestOptions,
  stream = false,
): OpenAiCompatibleChatCompletionRequest {
  return {
    model: provider.model,
    temperature: options?.temperature ?? 0.1,
    max_tokens: options?.maxOutputTokens ?? 400,
    top_p: options?.topP ?? DEFAULT_TOP_P,
    messages,
    stream: stream || undefined,
    stream_options: stream
      ? {
          include_usage: true,
        }
      : undefined,
  };
}

function buildRequestHeaders(provider: ResolvedProviderConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
}

function buildJsonCorrectionPrompt(
  reason: string,
  schema?: LlmJsonSchema<unknown>,
): string {
  const instructions = [
    "Your previous reply could not be accepted.",
    `Problem: ${reason}`,
    "Return JSON only.",
  ];

  if (schema) {
    instructions.push(`Schema name: ${schema.name}.`);
    if (schema.description?.trim()) {
      instructions.push(`Expected shape: ${schema.description.trim()}`);
    }
  }

  instructions.push("Do not include markdown fences or any extra commentary.");
  return instructions.join(" ");
}

function buildJsonRetryMessages(
  messages: LlmMessage[],
  rawText: string,
  reason: string,
  schema?: LlmJsonSchema<unknown>,
): LlmMessage[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: rawText,
    },
    {
      role: "user",
      content: buildJsonCorrectionPrompt(reason, schema),
    },
  ];
}

function ensureBudget(
  messages: LlmMessage[],
  options: LlmRequestOptions | undefined,
  operation: string,
): void {
  if (LLM_MAX_TOTAL_TOKENS <= 0) {
    return;
  }

  const projectedPromptTokens = estimatePromptTokens(messages);
  const projectedCompletionTokens = Math.max(0, options?.maxOutputTokens ?? 400);
  const projectedTotal = projectedPromptTokens + projectedCompletionTokens;

  if (projectedTotal <= LLM_MAX_TOTAL_TOKENS) {
    return;
  }

  const error = new LlmClientError({
    message: `LLM request exceeds configured token budget (${projectedTotal} > ${LLM_MAX_TOTAL_TOKENS}).`,
    code: "LLM_BUDGET_EXCEEDED",
    retryable: false,
  });

  logLlmRequest("llm.request.skipped", {
    operation,
    reason: error.message,
    code: error.code,
    projected_prompt_tokens: projectedPromptTokens,
    projected_completion_tokens: projectedCompletionTokens,
    projected_total_tokens: projectedTotal,
  });

  recordLlmCallEvent({
    operation,
    provider: LLM_PROVIDER,
    model: LLM_MODEL,
    attempts: 0,
    streamed: false,
    fallback_used: false,
    duration_ms: 0,
    output_chars: 0,
    status: "budget_rejected",
    usage: {
      prompt_tokens: projectedPromptTokens,
      completion_tokens: projectedCompletionTokens,
      total_tokens: projectedTotal,
      estimated: true,
    },
    error_code: error.code,
    error_message: error.message,
  });

  throw error;
}

function normalizeError(
  error: unknown,
  provider: ResolvedProviderConfig,
  maxAttempts: number,
  attempt: number,
): LlmClientError {
  if (error instanceof LlmClientError) {
    return error;
  }

  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Unknown LLM request failure.";

  return new LlmClientError({
    message:
      error instanceof Error && error.name === "AbortError"
        ? `LLM request timed out after ${LLM_TIMEOUT_MS}ms.`
        : message,
    code:
      error instanceof Error && error.name === "AbortError"
        ? "LLM_TIMEOUT"
        : "LLM_REQUEST_FAILED",
    retryable:
      error instanceof Error && error.name === "AbortError"
        ? true
        : attempt < maxAttempts,
    provider: provider.provider,
    model: provider.model,
  });
}

async function readErrorDetail(response: Response): Promise<string> {
  const responseText = (await response.text()).trim();
  let detail = responseText || "empty response body";

  try {
    const parsed = JSON.parse(responseText) as OpenAiCompatibleChatCompletionResponse;
    if (parsed.error?.message?.trim()) {
      detail = parsed.error.message.trim();
    }
  } catch {
    // Keep raw response text when the body is not JSON.
  }

  return detail;
}

async function executeNonStreamingRequest(
  provider: ResolvedProviderConfig,
  messages: LlmMessage[],
  options: LlmRequestOptions | undefined,
  signal: AbortSignal,
): Promise<{ text: string; usage: LlmUsage }> {
  const response = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: buildRequestHeaders(provider),
    body: JSON.stringify(buildRequestBody(provider, messages, options)),
    signal,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new LlmClientError({
      message: `LLM request failed with status ${response.status}: ${detail}`,
      code: "LLM_HTTP_ERROR",
      statusCode: response.status,
      retryable: isRetryableStatus(response.status),
      provider: provider.provider,
      model: provider.model,
    });
  }

  const payload = (await response.json()) as OpenAiCompatibleChatCompletionResponse;
  const text = getContentText(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new LlmClientError({
      message: "LLM response did not contain any text output.",
      code: "LLM_EMPTY_OUTPUT",
      retryable: false,
      provider: provider.provider,
      model: provider.model,
    });
  }

  return {
    text,
    usage: normalizeUsage(payload.usage, messages, text),
  };
}

async function executeStreamingRequest(
  provider: ResolvedProviderConfig,
  messages: LlmMessage[],
  options: LlmRequestOptions | undefined,
  signal: AbortSignal,
  handlers?: LlmStreamHandlers,
): Promise<{ text: string; usage: LlmUsage }> {
  const response = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: buildRequestHeaders(provider),
    body: JSON.stringify(buildRequestBody(provider, messages, options, true)),
    signal,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new LlmClientError({
      message: `LLM request failed with status ${response.status}: ${detail}`,
      code: "LLM_HTTP_ERROR",
      statusCode: response.status,
      retryable: isRetryableStatus(response.status),
      provider: provider.provider,
      model: provider.model,
    });
  }

  if (!response.body) {
    throw new LlmClientError({
      message: "LLM streaming response body was empty.",
      code: "LLM_EMPTY_STREAM",
      retryable: false,
      provider: provider.provider,
      model: provider.model,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let streamUsage: OpenAiCompatibleUsage | undefined;

  const processRawEvent = async (rawEvent: string): Promise<void> => {
    const lines = rawEvent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      const chunk = JSON.parse(payload) as OpenAiCompatibleChatCompletionChunk;
      const delta = getDeltaText(chunk.choices?.[0]?.delta?.content);
      if (delta) {
        answer += delta;
        await handlers?.onDelta?.(delta, answer);
      }

      if (chunk.usage) {
        streamUsage = chunk.usage;
      }

      if (chunk.error?.message?.trim()) {
        throw new LlmClientError({
          message: chunk.error.message.trim(),
          code: chunk.error.code ?? "LLM_STREAM_ERROR",
          retryable: false,
          provider: provider.provider,
          model: provider.model,
        });
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      await processRawEvent(rawEvent);

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    await processRawEvent(buffer);
  }

  if (!answer.trim()) {
    throw new LlmClientError({
      message: "LLM stream completed without any text output.",
      code: "LLM_EMPTY_OUTPUT",
      retryable: false,
      provider: provider.provider,
      model: provider.model,
    });
  }

  return {
    text: answer,
    usage: normalizeUsage(streamUsage, messages, answer),
  };
}

async function runLlmRequest(
  messages: LlmMessage[],
  options: LlmRequestOptions | undefined,
  execution: (
    provider: ResolvedProviderConfig,
    signal: AbortSignal,
  ) => Promise<{ text: string; usage: LlmUsage; streamed: boolean }>,
): Promise<LlmTextResult> {
  const availability = getAvailability();
  if (!availability.enabled) {
    throw new LlmClientError({
      message: availability.reason ?? "LLM is unavailable.",
      code: "LLM_UNAVAILABLE",
      retryable: false,
      provider: availability.provider,
      model: availability.model,
    });
  }

  const operation = options?.operation ?? "general";
  ensureBudget(messages, options, operation);

  const providerConfigs = getProviderConfigs();
  const maxAttempts = Math.max(1, LLM_RETRY_TIMES + 1);
  let totalAttemptCount = 0;
  let lastError: LlmClientError | null = null;

  for (let providerIndex = 0; providerIndex < providerConfigs.length; providerIndex += 1) {
    const provider = providerConfigs[providerIndex];
    if (!provider) {
      continue;
    }

    const providerStartedAt = Date.now();
    const fallbackUsed = providerIndex > 0;

    if (fallbackUsed) {
      logLlmRequest(
        "llm.request.provider_fallback",
        {
          operation,
          previous_provider: providerConfigs[providerIndex - 1]?.provider,
          next_provider: provider.provider,
        },
        provider,
      );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      totalAttemptCount += 1;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => {
        controller.abort();
      }, LLM_TIMEOUT_MS);

      logLlmRequest(
        "llm.request.attempt",
        {
          operation,
          attempt,
          provider_attempt_group: providerIndex + 1,
          fallback_used: fallbackUsed,
          url: buildChatCompletionsUrl(provider.baseUrl),
        },
        provider,
      );

      try {
        const result = await execution(provider, controller.signal);
        logLlmRequest(
          "llm.request.completed",
          {
            operation,
            attempt,
            fallback_used: fallbackUsed,
            streamed: result.streamed,
            usage: result.usage,
            success: true,
          },
          provider,
        );

        recordLlmCallEvent({
          operation,
          provider: provider.provider,
          model: provider.model,
          attempts: attempt,
          streamed: result.streamed,
          fallback_used: fallbackUsed,
          duration_ms: Date.now() - providerStartedAt,
          output_chars: result.text.length,
          status: "success",
          usage: result.usage,
        });

        return {
          text: result.text,
          provider: provider.provider,
          model: provider.model,
          attempt_count: totalAttemptCount,
          fallback_used: fallbackUsed,
          streamed: result.streamed,
          usage: result.usage,
        };
      } catch (error: unknown) {
        const normalizedError = normalizeError(error, provider, maxAttempts, attempt);
        lastError = normalizedError;

        logLlmRequest(
          "llm.request.failed",
          {
            operation,
            attempt,
            fallback_used: fallbackUsed,
            success: false,
            detail: normalizedError.message,
            code: normalizedError.code,
            status_code: normalizedError.statusCode,
            retryable: normalizedError.retryable,
          },
          provider,
        );

        if (attempt >= maxAttempts || !normalizedError.retryable) {
          recordLlmCallEvent({
            operation,
            provider: provider.provider,
            model: provider.model,
            attempts: attempt,
            streamed: false,
            fallback_used: fallbackUsed,
            duration_ms: Date.now() - providerStartedAt,
            output_chars: 0,
            status: "failed",
            usage: {
              prompt_tokens: estimatePromptTokens(messages),
              completion_tokens: 0,
              total_tokens: estimatePromptTokens(messages),
              estimated: true,
            },
            error_code: normalizedError.code,
            error_message: normalizedError.message,
          });
        }

        if (normalizedError.retryable && attempt < maxAttempts) {
          clearTimeout(timeoutHandle);
          continue;
        }

        break;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  }

  throw (
    lastError ??
    new LlmClientError({
      message: "LLM request failed.",
      code: "LLM_REQUEST_FAILED",
    })
  );
}

export class LlmClientError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly provider: string;
  readonly model: string;

  constructor(args: {
    message: string;
    code?: string;
    statusCode?: number;
    retryable?: boolean;
    provider?: string;
    model?: string;
  }) {
    super(args.message);
    this.name = "LlmClientError";
    this.code = args.code ?? "LLM_REQUEST_FAILED";
    this.statusCode = args.statusCode;
    this.retryable = args.retryable ?? false;
    this.provider = args.provider ?? LLM_PROVIDER;
    this.model = args.model ?? LLM_MODEL;
  }
}

export function getLlmAvailability(): LlmAvailability {
  return getAvailability();
}

export async function generateLlmText(
  messages: LlmMessage[],
  options?: LlmRequestOptions,
): Promise<LlmTextResult> {
  return runLlmRequest(messages, options, async (provider, signal) => {
    const result = await executeNonStreamingRequest(provider, messages, options, signal);
    return {
      ...result,
      streamed: false,
    };
  });
}

export async function generateLlmTextStream(
  messages: LlmMessage[],
  handlers: LlmStreamHandlers,
  options?: LlmRequestOptions,
): Promise<LlmTextResult> {
  return runLlmRequest(messages, options, async (provider, signal) => {
    const result = await executeStreamingRequest(
      provider,
      messages,
      options,
      signal,
      handlers,
    );
    return {
      ...result,
      streamed: true,
    };
  });
}

export async function generateLlmJson<T>(
  messages: LlmMessage[],
  options?: LlmRequestOptions,
  schema?: LlmJsonSchema<T>,
): Promise<{ data: T; rawText: string; provider: string; model: string; attempt_count: number }> {
  const maxSchemaAttempts = Math.max(
    1,
    (options?.jsonSchemaRetryTimes ?? DEFAULT_JSON_SCHEMA_RETRY_TIMES) + 1,
  );
  let attemptMessages = messages;
  let totalAttemptCount = 0;

  for (let schemaAttempt = 1; schemaAttempt <= maxSchemaAttempts; schemaAttempt += 1) {
    const result = await generateLlmText(attemptMessages, options);
    totalAttemptCount += result.attempt_count;
    const jsonText = extractJsonText(result.text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText) as unknown;
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to parse JSON output from LLM.";

      if (schemaAttempt < maxSchemaAttempts) {
        logLlmRequest("llm.json.validation_failed", {
          operation: options?.operation ?? "general",
          schema: schema?.name,
          schema_attempt: schemaAttempt,
          reason: message,
          failure_type: "json_parse",
        });
        attemptMessages = buildJsonRetryMessages(messages, result.text, message, schema);
        continue;
      }

      throw new LlmClientError({
        message: `${message} Raw output: ${jsonText}`,
        code: "LLM_JSON_PARSE_FAILED",
        retryable: false,
        provider: result.provider,
        model: result.model,
      });
    }

    if (schema && !schema.validate(parsed)) {
      const message = `JSON output did not match schema "${schema.name}".`;

      if (schemaAttempt < maxSchemaAttempts) {
        logLlmRequest("llm.json.validation_failed", {
          operation: options?.operation ?? "general",
          schema: schema.name,
          schema_attempt: schemaAttempt,
          reason: schema.description ?? message,
          failure_type: "schema_validation",
        });
        attemptMessages = buildJsonRetryMessages(messages, result.text, message, schema);
        continue;
      }

      throw new LlmClientError({
        message: `${message} Raw output: ${jsonText}`,
        code: "LLM_JSON_SCHEMA_FAILED",
        retryable: false,
        provider: result.provider,
        model: result.model,
      });
    }

    return {
      data: parsed as T,
      rawText: result.text,
      provider: result.provider,
      model: result.model,
      attempt_count: totalAttemptCount,
    };
  }

  throw new LlmClientError({
    message: "Failed to produce valid JSON output from LLM.",
    code: "LLM_JSON_PARSE_FAILED",
    retryable: false,
  });
}
