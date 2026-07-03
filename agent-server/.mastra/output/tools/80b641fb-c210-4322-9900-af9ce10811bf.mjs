import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { L as LLM_ENABLED, b as LLM_MAX_TOTAL_TOKENS, c as LLM_RETRY_TIMES, d as LLM_TIMEOUT_MS, e as LLM_MODEL, f as LLM_PROVIDER, w as writeStructuredLog, h as LLM_FALLBACK_PROVIDERS, i as recordLlmCallEvent, j as LLM_API_KEY, k as LLM_BASE_URL, l as RAG_LLM_QUERY_ENABLED, m as RAG_EMBEDDING_DIMENSIONS, n as RAG_RERANK_CANDIDATE_LIMIT, o as RAG_EMBEDDING_MODEL, p as RAG_EMBEDDING_PROVIDER, q as RAG_EMBEDDING_CACHE_ENABLED, s as RAG_RERANK_ENABLED, t as RAG_EMBEDDING_CACHE_PATH, u as RAG_ENABLED } from '../logger.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import 'dotenv';
import 'node:async_hooks';


// -- Shims --
import cjsUrl from 'node:url';
import cjsPath from 'node:path';
import cjsModule from 'node:module';
const __filename = cjsUrl.fileURLToPath(import.meta.url);
const __dirname = cjsPath.dirname(__filename);
const require = cjsModule.createRequire(import.meta.url);
const SCENARIOS = {
  queryRewrite: {
    operation: "query_rewrite",
    temperature: 0,
    maxOutputTokens: 240,
    topP: 1,
    systemPrompt: [
      "You rewrite short clinical follow-up questions into standalone questions for backend routing.",
      "Ambiguous follow-up questions are not considered clear and should usually be rewritten.",
      "You may use recent chat_history when it is provided.",
      "Only use information already present in the user question, last_question_type, and chat_history.",
      "Do not invent patient facts, metrics, diagnoses, dates, or field names.",
      "If the question is already clear, keep it unchanged.",
      "Prefer concise standalone rewrites that preserve routing intent.",
      "Examples:",
      "\u90A3\u5FC3\u7387\u5462\uFF1F -> \u8FD9\u4E2A\u60A3\u8005\u6700\u8FD1\u7684\u5FC3\u7387\u60C5\u51B5\u5982\u4F55\uFF1F",
      "\u90A3\u8840\u538B\u5462\uFF1F -> \u8FD9\u4E2A\u60A3\u8005\u6700\u8FD1\u7684\u8840\u538B\u60C5\u51B5\u5982\u4F55\uFF1F",
      "\u8FD9\u4E2A\u6307\u6807\u662F\u4EC0\u4E48\u610F\u601D\uFF1F -> \u8FD9\u4E2A\u6307\u6807\u4EE3\u8868\u4EC0\u4E48\uFF1F",
      "\u8FD9\u4E2A\u5B57\u6BB5\u5462\uFF1F -> \u8FD9\u4E2A\u5B57\u6BB5\u662F\u4EC0\u4E48\u610F\u601D\uFF1F",
      "\u518D\u770B\u4E00\u4E0B\u6700\u8FD1\u4E00\u6B21 -> \u8FD9\u4E2A\u60A3\u8005\u6700\u8FD1\u4E00\u6B21\u7684\u7ED3\u679C\u662F\u4EC0\u4E48\uFF1F",
      "And patient info? -> What is the patient's basic information?",
      "Return JSON only with keys: rewritten_question, changed, confidence, reason.",
      "confidence must be a number between 0 and 1."
    ].join(" ")
  },
  answerEnhancement: {
    operation: "answer_enhancement",
    temperature: 0,
    maxOutputTokens: 420,
    topP: 1,
    systemPrompt: [
      "You improve the readability of an existing clinical answer.",
      "You may only use the original answer, evidence, tool trace, limitation, and question provided.",
      "Do not add any fact that is not already supported by the original answer.",
      "Do not change or introduce any numeric value, timestamp, code, unit, metric name, or field name.",
      "Preserve any measurement label, value, unit, timestamp, code, and field text exactly as written.",
      "Preserve their left-to-right order from the original answer.",
      "Do not invent medical advice, treatment advice, or risk assessment.",
      "Only improve wording, structure, and readability.",
      "If the original answer is already clear, prefer returning it unchanged.",
      "Return JSON only with keys: enhanced_answer, changed, reason."
    ].join(" ")
  },
  ragQueryNormalization: {
    operation: "rag_query_normalization",
    temperature: 0,
    maxOutputTokens: 120,
    topP: 1,
    systemPrompt: [
      "You normalize a medical search query for local retrieval.",
      "Preserve the original meaning.",
      "Do not add any new medical fact, diagnosis, measurement, or patient detail.",
      "Return a short retrieval-oriented query only.",
      "Return JSON only with keys: normalized_query, changed, reason."
    ].join(" ")
  },
  generalAnswerFallback: {
    operation: "general_answer_fallback",
    temperature: 0.7,
    maxOutputTokens: 500,
    topP: 0.95,
    systemPrompt: [
      "\u4F60\u662F\u4E00\u4E2A\u4E13\u4E1A\u7684\u533B\u7597\u52A9\u624B\u3002",
      "\u5F53\u672C\u5730\u60A3\u8005\u6570\u636E\u7F3A\u5931\u65F6\uFF0C\u4F60\u9700\u8981\u5148\u660E\u786E\u8BF4\u660E\u5F53\u524D\u7CFB\u7EDF\u91CC\u6CA1\u6709\u627E\u5230\u5BF9\u5E94\u7684\u60A3\u8005\u7279\u5B9A\u6570\u636E\u3002",
      "\u968F\u540E\u53EA\u57FA\u4E8E\u901A\u7528\u533B\u5B66\u77E5\u8BC6\u7ED9\u51FA\u4E0E\u95EE\u9898\u76F8\u5173\u7684\u5E2E\u52A9\u4FE1\u606F\uFF0C\u4E0D\u8981\u7F16\u9020\u672C\u5730\u60A3\u8005\u4E8B\u5B9E\u3002",
      "\u56DE\u7B54\u8981\u4E13\u4E1A\u3001\u51C6\u786E\u3001\u6613\u61C2\uFF0C\u4F7F\u7528\u4E2D\u6587\u3002",
      "\u5982\u679C\u6D89\u53CA\u8BCA\u65AD\u3001\u6CBB\u7597\u65B9\u6848\u6216\u98CE\u9669\u5224\u65AD\uFF0C\u63D0\u9192\u7528\u6237\u4FE1\u606F\u4EC5\u4F9B\u53C2\u8003\uFF0C\u4E0D\u80FD\u66FF\u4EE3\u4E13\u4E1A\u533B\u751F\u5EFA\u8BAE\u3002"
    ].join(" ")
  }
};
function getLlmScenario(key) {
  return SCENARIOS[key];
}

const DEFAULT_JSON_SCHEMA_RETRY_TIMES = 1;
const DEFAULT_TOP_P = 1;
function resolveDefaultLlmBaseUrl(provider) {
  if (provider === "aliyun") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }
  return "https://api.openai.com/v1";
}
function resolveDefaultLlmModel(provider) {
  if (provider === "aliyun") {
    return "qwen-plus";
  }
  if (provider === "deepseek") {
    return "deepseek-chat";
  }
  return "gpt-4.1-mini";
}
function isSupportedProvider(provider) {
  return provider === "aliyun" || provider === "deepseek" || provider === "openai";
}
function readEnv(name) {
  return process.env[name]?.trim() ?? "";
}
function resolveProviderApiKey(provider) {
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
function resolveProviderModel(provider) {
  if (provider === LLM_PROVIDER && LLM_MODEL) {
    return LLM_MODEL;
  }
  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_MODEL") || resolveDefaultLlmModel(provider);
  }
  if (provider === "aliyun") {
    return readEnv("ALIYUN_MODEL") || readEnv("QWEN_MODEL") || resolveDefaultLlmModel(provider);
  }
  return readEnv("OPENAI_MODEL") || resolveDefaultLlmModel(provider);
}
function resolveProviderBaseUrl(provider) {
  if (provider === LLM_PROVIDER && LLM_BASE_URL) {
    return LLM_BASE_URL;
  }
  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_BASE_URL") || resolveDefaultLlmBaseUrl(provider);
  }
  if (provider === "aliyun") {
    return readEnv("ALIYUN_BASE_URL") || readEnv("DASHSCOPE_BASE_URL") || resolveDefaultLlmBaseUrl(provider);
  }
  return readEnv("OPENAI_BASE_URL") || resolveDefaultLlmBaseUrl(provider);
}
function resolveProviderConfig(provider) {
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
    baseUrl
  };
}
function getProviderConfigs() {
  const orderedProviders = [
    LLM_PROVIDER,
    ...LLM_FALLBACK_PROVIDERS
  ].filter((provider, index, values) => values.indexOf(provider) === index);
  return orderedProviders.filter(isSupportedProvider).map((provider) => resolveProviderConfig(provider)).filter((config) => config !== null);
}
function getAvailability() {
  if (!LLM_ENABLED) {
    return {
      enabled: false,
      provider: LLM_PROVIDER,
      model: LLM_MODEL,
      timeout_ms: LLM_TIMEOUT_MS,
      retry_times: LLM_RETRY_TIMES,
      fallback_providers: [],
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || void 0,
      reason: "LLM is disabled by configuration."
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
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || void 0,
      reason: `Unsupported LLM provider "${LLM_PROVIDER}".`
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
      budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || void 0,
      reason: "No configured LLM provider has a usable API key and model."
    };
  }
  return {
    enabled: true,
    provider: LLM_PROVIDER,
    model: LLM_MODEL,
    timeout_ms: LLM_TIMEOUT_MS,
    retry_times: LLM_RETRY_TIMES,
    fallback_providers: providerConfigs.slice(1).map((config) => config.provider),
    budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || void 0
  };
}
function buildChatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}
function getContentText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((item) => {
    if (typeof item !== "object" || item === null) {
      return "";
    }
    const text = item.text;
    return typeof text === "string" ? text : "";
  }).join("\n").trim();
}
function extractJsonText(rawText) {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}
function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
function estimateTokenCount(text) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil([...normalized].length / 4));
}
function estimatePromptTokens(messages) {
  return messages.reduce((total, message) => {
    return total + estimateTokenCount(message.role) + estimateTokenCount(message.content) + 4;
  }, 0);
}
function normalizeUsage(usage, messages, completionText) {
  const promptTokens = usage?.prompt_tokens ?? estimatePromptTokens(messages);
  const completionTokens = usage?.completion_tokens ?? estimateTokenCount(completionText);
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated: usage?.prompt_tokens === void 0 || usage?.completion_tokens === void 0 || usage?.total_tokens === void 0
  };
}
function logLlmRequest(event, payload, provider) {
  writeStructuredLog(event, {
    provider: provider?.provider ?? LLM_PROVIDER,
    model: provider?.model ?? LLM_MODEL,
    timeout_ms: LLM_TIMEOUT_MS,
    retry_times: LLM_RETRY_TIMES,
    fallback_providers: LLM_FALLBACK_PROVIDERS,
    budget_limit_tokens: LLM_MAX_TOTAL_TOKENS || void 0,
    ...payload,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function buildRequestBody(provider, messages, options, stream = false) {
  return {
    model: provider.model,
    temperature: options?.temperature ?? 0.1,
    max_tokens: options?.maxOutputTokens ?? 400,
    top_p: options?.topP ?? DEFAULT_TOP_P,
    messages,
    stream: stream || void 0,
    stream_options: stream ? {
      include_usage: true
    } : void 0
  };
}
function buildRequestHeaders(provider) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`
  };
}
function buildJsonCorrectionPrompt(reason, schema) {
  const instructions = [
    "Your previous reply could not be accepted.",
    `Problem: ${reason}`,
    "Return JSON only."
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
function buildJsonRetryMessages(messages, rawText, reason, schema) {
  return [
    ...messages,
    {
      role: "assistant",
      content: rawText
    },
    {
      role: "user",
      content: buildJsonCorrectionPrompt(reason, schema)
    }
  ];
}
function ensureBudget(messages, options, operation) {
  if (LLM_MAX_TOTAL_TOKENS <= 0) {
    return;
  }
  const projectedPromptTokens = estimatePromptTokens(messages);
  const projectedCompletionTokens = Math.max(0, options?.maxOutputTokens);
  const projectedTotal = projectedPromptTokens + projectedCompletionTokens;
  if (projectedTotal <= LLM_MAX_TOTAL_TOKENS) {
    return;
  }
  const error = new LlmClientError({
    message: `LLM request exceeds configured token budget (${projectedTotal} > ${LLM_MAX_TOTAL_TOKENS}).`,
    code: "LLM_BUDGET_EXCEEDED",
    retryable: false
  });
  logLlmRequest("llm.request.skipped", {
    operation,
    reason: error.message,
    code: error.code,
    projected_prompt_tokens: projectedPromptTokens,
    projected_completion_tokens: projectedCompletionTokens,
    projected_total_tokens: projectedTotal
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
      estimated: true
    },
    error_code: error.code,
    error_message: error.message
  });
  throw error;
}
function normalizeError(error, provider, maxAttempts, attempt) {
  if (error instanceof LlmClientError) {
    return error;
  }
  const message = error instanceof Error && error.message.trim() ? error.message : "Unknown LLM request failure.";
  return new LlmClientError({
    message: error instanceof Error && error.name === "AbortError" ? `LLM request timed out after ${LLM_TIMEOUT_MS}ms.` : message,
    code: error instanceof Error && error.name === "AbortError" ? "LLM_TIMEOUT" : "LLM_REQUEST_FAILED",
    retryable: error instanceof Error && error.name === "AbortError" ? true : attempt < maxAttempts,
    provider: provider.provider,
    model: provider.model
  });
}
async function readErrorDetail(response) {
  const responseText = (await response.text()).trim();
  let detail = responseText || "empty response body";
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error?.message?.trim()) {
      detail = parsed.error.message.trim();
    }
  } catch {
  }
  return detail;
}
async function executeNonStreamingRequest(provider, messages, options, signal) {
  const response = await fetch(buildChatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: buildRequestHeaders(provider),
    body: JSON.stringify(buildRequestBody(provider, messages, options)),
    signal
  });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new LlmClientError({
      message: `LLM request failed with status ${response.status}: ${detail}`,
      code: "LLM_HTTP_ERROR",
      statusCode: response.status,
      retryable: isRetryableStatus(response.status),
      provider: provider.provider,
      model: provider.model
    });
  }
  const payload = await response.json();
  const text = getContentText(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new LlmClientError({
      message: "LLM response did not contain any text output.",
      code: "LLM_EMPTY_OUTPUT",
      retryable: false,
      provider: provider.provider,
      model: provider.model
    });
  }
  return {
    text,
    usage: normalizeUsage(payload.usage, messages, text)
  };
}
async function runLlmRequest(messages, options, execution) {
  const availability = getAvailability();
  if (!availability.enabled) {
    throw new LlmClientError({
      message: availability.reason ?? "LLM is unavailable.",
      code: "LLM_UNAVAILABLE",
      retryable: false,
      provider: availability.provider,
      model: availability.model
    });
  }
  const operation = options?.operation;
  ensureBudget(messages, options, operation);
  const providerConfigs = getProviderConfigs();
  const maxAttempts = Math.max(1, LLM_RETRY_TIMES + 1);
  let totalAttemptCount = 0;
  let lastError = null;
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
          next_provider: provider.provider
        },
        provider
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
          url: buildChatCompletionsUrl(provider.baseUrl)
        },
        provider
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
            success: true
          },
          provider
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
          usage: result.usage
        });
        return {
          text: result.text,
          provider: provider.provider,
          model: provider.model,
          attempt_count: totalAttemptCount,
          fallback_used: fallbackUsed,
          streamed: result.streamed,
          usage: result.usage
        };
      } catch (error) {
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
            retryable: normalizedError.retryable
          },
          provider
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
              estimated: true
            },
            error_code: normalizedError.code,
            error_message: normalizedError.message
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
  throw lastError ?? new LlmClientError({
    message: "LLM request failed.",
    code: "LLM_REQUEST_FAILED"
  });
}
class LlmClientError extends Error {
  constructor(args) {
    super(args.message);
    this.name = "LlmClientError";
    this.code = args.code ?? "LLM_REQUEST_FAILED";
    this.statusCode = args.statusCode;
    this.retryable = args.retryable ?? false;
    this.provider = args.provider ?? LLM_PROVIDER;
    this.model = args.model ?? LLM_MODEL;
  }
}
function getLlmAvailability() {
  return getAvailability();
}
async function generateLlmText(messages, options) {
  return runLlmRequest(messages, options, async (provider, signal) => {
    const result = await executeNonStreamingRequest(provider, messages, options, signal);
    return {
      ...result,
      streamed: false
    };
  });
}
async function generateLlmJson(messages, options, schema) {
  const maxSchemaAttempts = Math.max(
    1,
    (options?.jsonSchemaRetryTimes ?? DEFAULT_JSON_SCHEMA_RETRY_TIMES) + 1
  );
  let attemptMessages = messages;
  let totalAttemptCount = 0;
  for (let schemaAttempt = 1; schemaAttempt <= maxSchemaAttempts; schemaAttempt += 1) {
    const result = await generateLlmText(attemptMessages, options);
    totalAttemptCount += result.attempt_count;
    const jsonText = extractJsonText(result.text);
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : "Failed to parse JSON output from LLM.";
      if (schemaAttempt < maxSchemaAttempts) {
        logLlmRequest("llm.json.validation_failed", {
          operation: options?.operation,
          schema: schema?.name,
          schema_attempt: schemaAttempt,
          reason: message,
          failure_type: "json_parse"
        });
        attemptMessages = buildJsonRetryMessages(messages, result.text, message, schema);
        continue;
      }
      throw new LlmClientError({
        message: `${message} Raw output: ${jsonText}`,
        code: "LLM_JSON_PARSE_FAILED",
        retryable: false,
        provider: result.provider,
        model: result.model
      });
    }
    if (schema && !schema.validate(parsed)) {
      const message = `JSON output did not match schema "${schema.name}".`;
      if (schemaAttempt < maxSchemaAttempts) {
        logLlmRequest("llm.json.validation_failed", {
          operation: options?.operation,
          schema: schema.name,
          schema_attempt: schemaAttempt,
          reason: schema.description ?? message,
          failure_type: "schema_validation"
        });
        attemptMessages = buildJsonRetryMessages(messages, result.text, message, schema);
        continue;
      }
      throw new LlmClientError({
        message: `${message} Raw output: ${jsonText}`,
        code: "LLM_JSON_SCHEMA_FAILED",
        retryable: false,
        provider: result.provider,
        model: result.model
      });
    }
    return {
      data: parsed,
      rawText: result.text,
      provider: result.provider,
      model: result.model,
      attempt_count: totalAttemptCount
    };
  }
  throw new LlmClientError({
    message: "Failed to produce valid JSON output from LLM.",
    code: "LLM_JSON_PARSE_FAILED",
    retryable: false
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeText$2(value) {
  return value.replace(/\s+/g, " ").trim();
}
function logNormalization(result) {
  writeStructuredLog("rag.query_normalization", {
    enabled: result.enabled,
    changed: result.changed,
    source: result.source,
    normalized_query: result.normalized_query,
    reason: result.reason,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  return result;
}
async function normalizeRagQuery(input) {
  const originalQuestion = normalizeText$2(input.question);
  if (!RAG_LLM_QUERY_ENABLED) {
    return logNormalization({
      enabled: false,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason: "rag_llm_query_disabled"
    });
  }
  const availability = getLlmAvailability();
  if (!availability.enabled) {
    return logNormalization({
      enabled: true,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason: availability.reason
    });
  }
  try {
    const scenario = getLlmScenario("ragQueryNormalization");
    const result = await generateLlmJson(
      [
        {
          role: "system",
          content: scenario.systemPrompt
        },
        {
          role: "user",
          content: JSON.stringify({
            route_type: input.routeType,
            question: originalQuestion
          })
        }
      ],
      {
        temperature: scenario.temperature,
        maxOutputTokens: scenario.maxOutputTokens,
        topP: scenario.topP,
        operation: scenario.operation
      },
      {
        name: "rag_query_normalization_payload",
        description: 'An object like {"normalized_query":"...","changed":true,"reason":"..."} where normalized_query is a string and changed is a boolean.',
        validate: (value) => {
          if (!isRecord(value)) {
            return false;
          }
          if (typeof value.normalized_query !== "string") {
            return false;
          }
          if (typeof value.changed !== "boolean") {
            return false;
          }
          if ("reason" in value && typeof value.reason !== "string") {
            return false;
          }
          return true;
        }
      }
    );
    const normalizedQuery = typeof result.data.normalized_query === "string" ? normalizeText$2(result.data.normalized_query) : originalQuestion;
    const changed = typeof result.data.changed === "boolean" ? result.data.changed && normalizedQuery !== originalQuestion : normalizedQuery !== originalQuestion;
    return logNormalization({
      enabled: true,
      normalized_query: changed ? normalizedQuery : originalQuestion,
      changed,
      source: changed ? "llm" : "none",
      reason: typeof result.data.reason === "string" && result.data.reason.trim() ? result.data.reason.trim() : changed ? "rag_query_normalized" : "rag_query_unchanged"
    });
  } catch (error) {
    const reason = error instanceof LlmClientError ? error.message : error instanceof Error ? error.message : "rag_query_normalization_failed";
    return logNormalization({
      enabled: true,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason
    });
  }
}

const CACHE_VERSION = 1;
const inMemoryCache = /* @__PURE__ */ new Map();
function isEmbeddingProvider(value) {
  return value === "local" || value === "openai";
}
function toAbsoluteCachePath(cachePath) {
  if (path.isAbsolute(cachePath)) {
    return cachePath;
  }
  const candidates = [
    path.resolve(process.cwd(), cachePath),
    path.resolve(process.cwd(), "agent-server", cachePath),
    path.resolve(__dirname, "../../../../", cachePath)
  ];
  const existing = candidates.find((candidate) => {
    const normalizedCandidate = path.normalize(candidate);
    const normalizedRoot = path.normalize(path.resolve(__dirname, "../../../../"));
    return normalizedCandidate.startsWith(normalizedRoot);
  });
  return existing ?? path.resolve(process.cwd(), cachePath);
}
function normalizeText$1(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[_/\\-]+/g, " ").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}
function tokenize(value) {
  const normalized = normalizeText$1(value);
  const tokens = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{1,}/g) ?? [];
  const expanded = [];
  tokens.forEach((token) => {
    expanded.push(token);
    if (/^[\u4e00-\u9fff]+$/u.test(token)) {
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          expanded.push(token.slice(index, index + size));
        }
      }
    }
  });
  return expanded.filter((token) => token.length >= 2);
}
function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector.map(() => 0);
  }
  return vector.map((value) => Number((value / norm).toFixed(8)));
}
function buildLocalEmbedding(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  tokens.forEach((token) => {
    const digest = createHash("sha256").update(token).digest();
    const weight = 1 + Math.min(token.length, 12) / 12;
    for (let projection = 0; projection < 3; projection += 1) {
      const index = digest[projection] % dimensions;
      const sign = digest[projection + 8] % 2 === 0 ? 1 : -1;
      vector[index] += sign * weight;
    }
  });
  return normalizeVector(vector);
}
function buildEntryText(entry) {
  return [
    entry.title,
    entry.aliases.join(" "),
    entry.keywords.join(" "),
    entry.content
  ].join("\n").trim();
}
function buildContentHash(entry) {
  return createHash("sha256").update(buildEntryText(entry)).digest("hex");
}
async function requestOpenAiEmbedding(input, model) {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not configured.");
  }
  const response = await fetch(`${LLM_BASE_URL.replace(/\/+$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Embedding request failed with status ${response.status}: ${detail || "empty response body"}`
    );
  }
  const payload = await response.json();
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embedding response did not include a usable vector.");
  }
  return normalizeVector(vector.map((value) => Number(value)));
}
async function embedText(text, config) {
  if (config.embeddingProvider === "local") {
    return buildLocalEmbedding(text, config.embeddingDimensions);
  }
  return requestOpenAiEmbedding(text, config.embeddingModel);
}
function isValidCacheFile(cache, entries, config) {
  if (cache.version !== CACHE_VERSION || cache.provider !== config.embeddingProvider || cache.model !== config.embeddingModel || cache.dimensions !== config.embeddingDimensions || cache.entries.length !== entries.length) {
    return false;
  }
  const expectedHashes = new Map(entries.map((entry) => [entry.id, buildContentHash(entry)]));
  return cache.entries.every((item) => expectedHashes.get(item.id) === item.content_hash);
}
async function readCacheFile(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
async function writeCacheFile(cachePath, cache) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}
`, "utf8");
}
async function buildCacheFile(entries, config) {
  const cacheEntries = [];
  for (const entry of entries) {
    const vector = await embedText(buildEntryText(entry), config);
    cacheEntries.push({
      id: entry.id,
      title: entry.title,
      source: entry.source,
      content_hash: buildContentHash(entry),
      vector
    });
  }
  return {
    version: CACHE_VERSION,
    provider: config.embeddingProvider,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    entries: cacheEntries
  };
}
function resolveRagExperimentConfig(overrides = {}) {
  const provider = overrides.embeddingProvider ?? (isEmbeddingProvider(RAG_EMBEDDING_PROVIDER) ? RAG_EMBEDDING_PROVIDER : "local");
  return {
    rerankEnabled: overrides.rerankEnabled ?? RAG_RERANK_ENABLED,
    embeddingCacheEnabled: overrides.embeddingCacheEnabled ?? RAG_EMBEDDING_CACHE_ENABLED,
    embeddingProvider: provider,
    embeddingModel: overrides.embeddingModel ?? RAG_EMBEDDING_MODEL,
    embeddingCachePath: toAbsoluteCachePath(
      overrides.embeddingCachePath ?? RAG_EMBEDDING_CACHE_PATH
    ),
    candidateLimit: overrides.candidateLimit ?? RAG_RERANK_CANDIDATE_LIMIT,
    embeddingDimensions: overrides.embeddingDimensions ?? RAG_EMBEDDING_DIMENSIONS
  };
}
function cosineSimilarity(left, right) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }
  return Number(
    left.reduce((sum, value, index) => sum + value * right[index], 0).toFixed(8)
  );
}
async function getQueryEmbedding(question, overrides = {}) {
  const config = resolveRagExperimentConfig(overrides);
  try {
    return {
      vector: await embedText(question, config),
      config
    };
  } catch (error) {
    return {
      config,
      reason: error instanceof Error && error.message.trim() ? error.message : "Failed to build query embedding."
    };
  }
}
async function ensureEmbeddingCache(entries, overrides = {}) {
  const config = resolveRagExperimentConfig(overrides);
  if (!config.embeddingCacheEnabled) {
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      reason: "Embedding cache is disabled."
    };
  }
  const memoryKey = `${config.embeddingProvider}:${config.embeddingModel}:${config.embeddingCachePath}`;
  const memoryCache = inMemoryCache.get(memoryKey);
  if (memoryCache && isValidCacheFile(memoryCache, entries, config)) {
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      cache: memoryCache
    };
  }
  const diskCache = await readCacheFile(config.embeddingCachePath);
  if (diskCache && isValidCacheFile(diskCache, entries, config)) {
    inMemoryCache.set(memoryKey, diskCache);
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      cache: diskCache
    };
  }
  try {
    const cache = await buildCacheFile(entries, config);
    await writeCacheFile(config.embeddingCachePath, cache);
    inMemoryCache.set(memoryKey, cache);
    writeStructuredLog("rag.embedding_cache.ready", {
      cache_path: config.embeddingCachePath,
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      entries: cache.entries.length,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return {
      cachePath: config.embeddingCachePath,
      created: true,
      cache
    };
  } catch (error) {
    const reason = error instanceof Error && error.message.trim() ? error.message : "Failed to build embedding cache.";
    writeStructuredLog("rag.embedding_cache.failed", {
      cache_path: config.embeddingCachePath,
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      detail: reason,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      reason
    };
  }
}

function toScore(value) {
  return Number(value.toFixed(6));
}
function updateMatchScore(item, lexicalScore, embeddingSimilarity, combinedScore) {
  return {
    ...item,
    score: toScore(combinedScore * 100),
    embedding_similarity: toScore(embeddingSimilarity),
    lexical_score: toScore(lexicalScore),
    score_breakdown: {
      ...item.score_breakdown,
      rerank: toScore(combinedScore * 100),
      embedding_similarity: toScore(embeddingSimilarity)
    }
  };
}
async function applyOptionalRerank(input) {
  const config = resolveRagExperimentConfig(input.experiment);
  const baseDiagnostics = {
    enabled: config.rerankEnabled || config.embeddingCacheEnabled,
    applied: false,
    strategy: "embedding-cache-rerank",
    provider: config.embeddingProvider,
    model: config.embeddingModel,
    cache_path: config.embeddingCachePath,
    candidate_count: input.baselineItems.length,
    rescored_count: 0
  };
  if (!config.rerankEnabled) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "Rerank is disabled."
      }
    };
  }
  if (!config.embeddingCacheEnabled) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "Embedding cache is disabled."
      }
    };
  }
  if (input.baselineItems.length === 0) {
    return {
      items: [],
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "No baseline candidates were available for reranking."
      }
    };
  }
  const cacheEntries = [...input.corpusEntriesById.values()];
  const cacheResult = await ensureEmbeddingCache(cacheEntries, input.experiment);
  if (!cacheResult.cache) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: cacheResult.reason ?? "Embedding cache is unavailable."
      }
    };
  }
  const queryEmbeddingResult = await getQueryEmbedding(input.question, input.experiment);
  if (!queryEmbeddingResult.vector) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: queryEmbeddingResult.reason ?? "Query embedding is unavailable."
      }
    };
  }
  const vectorById = new Map(cacheResult.cache.entries.map((entry) => [entry.id, entry.vector]));
  const maxLexicalScore = Math.max(...input.baselineItems.map((item) => item.score), 1);
  const reranked = input.baselineItems.map((item, index) => {
    const vector = vectorById.get(item.id);
    const lexicalScore = item.score / maxLexicalScore;
    const embeddingSimilarity = vector && queryEmbeddingResult.vector ? (cosineSimilarity(queryEmbeddingResult.vector, vector) + 1) / 2 : 0;
    const combinedScore = lexicalScore * 0.45 + embeddingSimilarity * 0.55;
    return {
      match: updateMatchScore(item, lexicalScore, embeddingSimilarity, combinedScore),
      combinedScore,
      index
    };
  }).sort((left, right) => {
    if (right.combinedScore === left.combinedScore) {
      return left.index - right.index;
    }
    return right.combinedScore - left.combinedScore;
  }).slice(0, input.limit).map((item) => item.match);
  return {
    items: reranked,
    retriever: "hybrid+embedding-cache-rerank",
    experiment: {
      ...baseDiagnostics,
      applied: true,
      rescored_count: reranked.length
    }
  };
}

const CORPUS_FILES = [
  "medical_terms.json",
  "lab_item_explanations.json",
  "mimic_field_dictionary.json",
  "diagnosis_explanations.json"
];
const CONCEPT_RULES = [
  {
    id: "wbc",
    canonical: "white blood cell",
    aliases: [
      "wbc",
      "white blood cell",
      "white blood cells",
      "white blood cell count",
      "\u767D\u7EC6\u80DE",
      "\u767D\u7EC6\u80DE\u8BA1\u6570"
    ]
  },
  {
    id: "glucose",
    canonical: "glucose",
    aliases: [
      "glucose",
      "blood glucose",
      "serum glucose",
      "blood sugar",
      "glucose level",
      "\u8840\u7CD6",
      "\u8461\u8404\u7CD6"
    ]
  },
  {
    id: "hemoglobin",
    canonical: "hemoglobin",
    aliases: [
      "hemoglobin",
      "haemoglobin",
      "hb",
      "\u8840\u7EA2\u86CB\u767D"
    ]
  },
  {
    id: "heart-rate",
    canonical: "heart rate",
    aliases: [
      "heart rate",
      "pulse",
      "hr",
      "\u5FC3\u7387",
      "\u8109\u640F"
    ]
  },
  {
    id: "blood-pressure",
    canonical: "blood pressure",
    aliases: [
      "blood pressure",
      "bp",
      "\u8840\u538B",
      "\u6536\u7F29\u538B",
      "\u8212\u5F20\u538B"
    ]
  },
  {
    id: "charttime",
    canonical: "charttime",
    aliases: [
      "charttime",
      "chart time",
      "recorded time",
      "record time",
      "observation time",
      "\u56FE\u8868\u65F6\u95F4",
      "\u8BB0\u5F55\u65F6\u95F4",
      "\u89C2\u5BDF\u65F6\u95F4"
    ]
  },
  {
    id: "hadm-id",
    canonical: "hadm_id",
    aliases: [
      "hadm_id",
      "hadm id",
      "hospital admission id",
      "hospitalization admission id",
      "admission id",
      "\u4F4F\u9662\u53F7",
      "\u4F4F\u9662\u53F7\u5B57\u6BB5",
      "\u4F4F\u9662\u6807\u8BC6"
    ]
  }
];
const CATEGORY_HINT_RULES = [
  {
    value: "field",
    aliases: ["field", "column", "\u5B57\u6BB5", "\u5217\u540D"]
  },
  {
    value: "metric",
    aliases: [
      "metric",
      "indicator",
      "lab",
      "vital",
      "\u6307\u6807",
      "\u5316\u9A8C",
      "\u68C0\u9A8C",
      "\u751F\u547D\u4F53\u5F81"
    ]
  },
  {
    value: "term",
    aliases: ["term", "abbreviation", "\u7F29\u5199", "\u672F\u8BED"]
  },
  {
    value: "diagnosis",
    aliases: ["diagnosis", "icd", "\u8BCA\u65AD"]
  },
  {
    value: "knowledge",
    aliases: ["knowledge", "explain", "meaning", "\u89E3\u91CA", "\u542B\u4E49"]
  }
];
const DOMAIN_HINT_RULES = [
  {
    value: "lab",
    aliases: [
      "lab",
      "glucose",
      "wbc",
      "hemoglobin",
      "creatinine",
      "lactate",
      "\u8840\u7CD6",
      "\u767D\u7EC6\u80DE",
      "\u8840\u7EA2\u86CB\u767D",
      "\u5316\u9A8C",
      "\u68C0\u9A8C"
    ]
  },
  {
    value: "vital",
    aliases: [
      "vital",
      "heart rate",
      "pulse",
      "blood pressure",
      "temperature",
      "spo2",
      "\u5FC3\u7387",
      "\u8840\u538B",
      "\u4F53\u6E29",
      "\u8840\u6C27",
      "\u751F\u547D\u4F53\u5F81"
    ]
  },
  {
    value: "patient",
    aliases: [
      "patient",
      "admission",
      "hadm",
      "charttime",
      "\u60A3\u8005",
      "\u4F4F\u9662",
      "\u5B57\u6BB5",
      "\u8BB0\u5F55\u65F6\u95F4"
    ]
  },
  {
    value: "diagnosis",
    aliases: [
      "diagnosis",
      "icd",
      "sepsis",
      "pneumonia",
      "aki",
      "\u8BCA\u65AD",
      "\u8113\u6BD2\u75C7",
      "\u80BA\u708E",
      "\u6025\u6027\u80BE\u635F\u4F24"
    ]
  }
];
const SCORE_WEIGHTS = Object.freeze({
  exactTitle: 72,
  partialTitle: 44,
  exactAlias: 64,
  partialAlias: 36,
  keywordPhrase: 14,
  titleToken: 10,
  tokenOverlap: 28,
  concept: 22,
  routeCategory: 18,
  hintCategory: 8,
  domainHint: 6
});
let corpusCache = null;
let indexedCorpusCache = null;
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
}
function isKnownCategory(value) {
  return value === "metric" || value === "field" || value === "term" || value === "diagnosis" || value === "knowledge";
}
function isKnownDomain(value) {
  return value === "lab" || value === "vital" || value === "patient" || value === "diagnosis" || value === "general";
}
function normalizeEntry(value, sourceFile, index) {
  if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.content !== "string") {
    return null;
  }
  return {
    id: value.id.trim() || `${sourceFile}-${index}`,
    title: value.title.trim(),
    source: typeof value.source === "string" && value.source.trim() ? value.source.trim() : `docs/rag/${sourceFile}`,
    content: value.content.trim(),
    category: isKnownCategory(value.category) ? value.category : "knowledge",
    domain: isKnownDomain(value.domain) ? value.domain : "general",
    aliases: normalizeStringArray(value.aliases),
    keywords: normalizeStringArray(value.keywords)
  };
}
function normalizeText(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[_/\\-]+/g, " ").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
}
function extractTokens(normalized) {
  const tokens = /* @__PURE__ */ new Set();
  const matches = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  matches.forEach((match) => {
    if (/^[a-z0-9]+$/.test(match)) {
      if (match.length >= 2) {
        tokens.add(match);
      }
      return;
    }
    tokens.add(match);
    for (let size = 2; size <= Math.min(4, match.length); size += 1) {
      for (let index = 0; index <= match.length - size; index += 1) {
        tokens.add(match.slice(index, index + size));
      }
    }
  });
  return tokens;
}
function addNormalizedPhraseTokens(target, phrase) {
  extractTokens(normalizeText(phrase)).forEach((token) => {
    target.add(token);
  });
}
function detectHintValues(normalized, rules) {
  const matches = /* @__PURE__ */ new Set();
  rules.forEach((rule) => {
    const hit = rule.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias.length > 0 && normalized.includes(normalizedAlias);
    });
    if (hit) {
      matches.add(rule.value);
    }
  });
  return matches;
}
function buildTextProfile(value) {
  const normalized = normalizeText(value);
  const tokens = extractTokens(normalized);
  const concepts = /* @__PURE__ */ new Set();
  CONCEPT_RULES.forEach((rule) => {
    const matchedAlias = rule.aliases.find((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias.length > 0 && normalized.includes(normalizedAlias);
    });
    if (!matchedAlias) {
      return;
    }
    concepts.add(rule.id);
    tokens.add(rule.id);
    addNormalizedPhraseTokens(tokens, rule.canonical);
    rule.aliases.forEach((alias) => {
      addNormalizedPhraseTokens(tokens, alias);
    });
  });
  return {
    normalized,
    tokens,
    concepts,
    categoryHints: detectHintValues(normalized, CATEGORY_HINT_RULES),
    domainHints: detectHintValues(normalized, DOMAIN_HINT_RULES)
  };
}
function mergeSets(...sets) {
  const merged = /* @__PURE__ */ new Set();
  sets.forEach((set) => {
    set.forEach((item) => {
      merged.add(item);
    });
  });
  return merged;
}
function splitContentIntoSentences(content) {
  const segments = content.split(/(?<=[.!?。！？；;])\s*/u).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments : [content.trim()];
}
function indexEntry(entry) {
  const titleProfile = buildTextProfile(entry.title);
  const aliasProfiles = entry.aliases.map((alias) => ({
    raw: alias,
    ...buildTextProfile(alias)
  }));
  const keywordProfiles = entry.keywords.map((keyword) => ({
    raw: keyword,
    ...buildTextProfile(keyword)
  }));
  const contentProfile = buildTextProfile(entry.content);
  const contentSentences = splitContentIntoSentences(entry.content).map((sentence) => ({
    text: sentence,
    profile: buildTextProfile(sentence)
  }));
  const searchTokens = mergeSets(
    titleProfile.tokens,
    contentProfile.tokens,
    ...aliasProfiles.map((profile) => profile.tokens),
    ...keywordProfiles.map((profile) => profile.tokens)
  );
  const concepts = mergeSets(
    titleProfile.concepts,
    contentProfile.concepts,
    ...aliasProfiles.map((profile) => profile.concepts),
    ...keywordProfiles.map((profile) => profile.concepts)
  );
  return {
    entry,
    titleProfile,
    aliasProfiles,
    keywordProfiles,
    contentProfile,
    contentSentences,
    searchTokens,
    concepts
  };
}
async function findDocsDirectory() {
  const candidates = [
    ...process.env.RAG_DOCS_DIR?.trim() ? [path.resolve(process.env.RAG_DOCS_DIR.trim())] : [],
    path.resolve(process.cwd(), "docs/rag"),
    path.resolve(process.cwd(), "../docs/rag"),
    // Covers the Mastra dev/build output dir (agent-server/.mastra/output).
    path.resolve(process.cwd(), "../../../docs/rag"),
    // __dirname only exists in CJS builds (ts-node-dev / tsc); the Mastra
    // bundle is ESM, so guard it instead of referencing it unconditionally.
    ...typeof __dirname !== "undefined" ? [path.resolve(__dirname, "../../../../docs/rag")] : []
  ];
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) {
        return candidate;
      }
    } catch {
    }
  }
  return null;
}
async function loadCorpus() {
  if (corpusCache) {
    return corpusCache;
  }
  const docsDirectory = await findDocsDirectory();
  if (!docsDirectory) {
    writeStructuredLog("rag.corpus.missing", {
      detail: "docs/rag directory was not found.",
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    corpusCache = [];
    indexedCorpusCache = [];
    return corpusCache;
  }
  const entries = [];
  for (const fileName of CORPUS_FILES) {
    const filePath = path.join(docsDirectory, fileName);
    try {
      const rawText = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        continue;
      }
      parsed.forEach((item, index) => {
        if (typeof item !== "object" || item === null) {
          return;
        }
        const normalized = normalizeEntry(item, fileName, index);
        if (normalized) {
          entries.push(normalized);
        }
      });
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message : "Unknown corpus loading error.";
      writeStructuredLog("rag.corpus.file_failed", {
        file: filePath,
        detail,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  corpusCache = entries;
  indexedCorpusCache = entries.map(indexEntry);
  return corpusCache;
}
async function loadIndexedCorpus() {
  if (indexedCorpusCache) {
    return indexedCorpusCache;
  }
  await loadCorpus();
  indexedCorpusCache = (corpusCache ?? []).map(indexEntry);
  return indexedCorpusCache;
}
function getRouteCategoryBonus(routeType, entry) {
  switch (routeType) {
    case "field_explanation":
      return entry.category === "field" ? SCORE_WEIGHTS.routeCategory : 0;
    case "metric_explanation":
      return entry.category === "metric" ? SCORE_WEIGHTS.routeCategory : 0;
    case "term_explanation":
      return entry.category === "term" || entry.category === "diagnosis" ? SCORE_WEIGHTS.routeCategory : 0;
    case "knowledge_query":
      return entry.category === "knowledge" ? Math.round(SCORE_WEIGHTS.routeCategory / 2) : 0;
    default:
      return 0;
  }
}
function intersectSets(left, right) {
  const intersection = [];
  left.forEach((value) => {
    if (right.has(value)) {
      intersection.push(value);
    }
  });
  return intersection;
}
function phraseWeight(queryProfile, candidateProfile, exactWeight, partialWeight) {
  if (!candidateProfile.normalized) {
    return 0;
  }
  if (queryProfile.normalized === candidateProfile.normalized) {
    return exactWeight;
  }
  return queryProfile.normalized.includes(candidateProfile.normalized) ? partialWeight : 0;
}
function scoreTokenOverlap(queryProfile, entry) {
  const sharedTitleTokens = intersectSets(queryProfile.tokens, entry.titleProfile.tokens);
  const sharedSearchTokens = intersectSets(queryProfile.tokens, entry.searchTokens);
  const titleScore = sharedTitleTokens.length * SCORE_WEIGHTS.titleToken;
  if (sharedSearchTokens.length === 0) {
    return titleScore;
  }
  const ratio = sharedSearchTokens.length / Math.max(queryProfile.tokens.size, Math.min(entry.searchTokens.size, 12), 1);
  return titleScore + Math.round(ratio * SCORE_WEIGHTS.tokenOverlap);
}
function scoreConceptOverlap(queryProfile, entry) {
  const sharedConcepts = intersectSets(queryProfile.concepts, entry.concepts);
  return sharedConcepts.length * SCORE_WEIGHTS.concept;
}
function buildMatchedTerms(queryProfile, entry) {
  const matched = /* @__PURE__ */ new Set();
  if (queryProfile.normalized.includes(entry.titleProfile.normalized) && entry.entry.title.trim().length > 0) {
    matched.add(entry.entry.title);
  }
  entry.aliasProfiles.forEach((profile) => {
    if (profile.normalized && queryProfile.normalized.includes(profile.normalized)) {
      matched.add(profile.raw);
    }
  });
  entry.keywordProfiles.forEach((profile) => {
    if (profile.normalized && queryProfile.normalized.includes(profile.normalized)) {
      matched.add(profile.raw);
    }
  });
  intersectSets(queryProfile.concepts, entry.concepts).forEach((conceptId) => {
    const conceptRule = CONCEPT_RULES.find((rule) => rule.id === conceptId);
    matched.add(conceptRule?.canonical ?? conceptId);
  });
  return [...matched].slice(0, 6);
}
function scoreEntry(queryProfile, routeType, entry) {
  const exact = phraseWeight(
    queryProfile,
    entry.titleProfile,
    SCORE_WEIGHTS.exactTitle,
    SCORE_WEIGHTS.partialTitle
  );
  const alias = entry.aliasProfiles.reduce((maxScore, profile) => {
    const weight = phraseWeight(
      queryProfile,
      profile,
      SCORE_WEIGHTS.exactAlias,
      SCORE_WEIGHTS.partialAlias
    );
    return Math.max(maxScore, weight);
  }, 0);
  const keyword = Math.min(
    entry.keywordProfiles.reduce((total, profile) => {
      if (!profile.normalized || !queryProfile.normalized.includes(profile.normalized)) {
        return total;
      }
      return total + SCORE_WEIGHTS.keywordPhrase;
    }, 0),
    SCORE_WEIGHTS.keywordPhrase * 2
  );
  const token_overlap = scoreTokenOverlap(queryProfile, entry);
  const concept = scoreConceptOverlap(queryProfile, entry);
  const category = getRouteCategoryBonus(routeType, entry.entry) + (queryProfile.categoryHints.has(entry.entry.category) ? SCORE_WEIGHTS.hintCategory : 0);
  const domain = queryProfile.domainHints.has(entry.entry.domain) ? SCORE_WEIGHTS.domainHint : 0;
  const lexicalScore = exact + alias + keyword + token_overlap + concept;
  const scoreBreakdown = {
    exact,
    alias,
    keyword,
    token_overlap,
    concept,
    category,
    domain
  };
  const score = lexicalScore + category + domain;
  if (lexicalScore < 12 || score < 18) {
    return {
      score: 0,
      scoreBreakdown,
      matchedTerms: []
    };
  }
  return {
    score,
    scoreBreakdown,
    matchedTerms: buildMatchedTerms(queryProfile, entry)
  };
}
function scoreSentence(queryProfile, sentence) {
  const tokenHits = intersectSets(queryProfile.tokens, sentence.profile.tokens).length;
  const conceptHits = intersectSets(queryProfile.concepts, sentence.profile.concepts).length;
  return tokenHits * 6 + conceptHits * 18;
}
function pickBestChunk(queryProfile, entry) {
  if (entry.contentSentences.length === 0) {
    return entry.entry.content;
  }
  const rankedSentences = entry.contentSentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreSentence(queryProfile, sentence)
  })).sort((left, right) => right.score - left.score);
  const best = rankedSentences[0];
  if (!best || best.score <= 0) {
    return entry.contentSentences[0]?.text ?? entry.entry.content;
  }
  const parts = [best.sentence.text];
  const nextSentence = rankedSentences.find(
    (candidate) => candidate.index === best.index + 1 && candidate.score > 0
  );
  if (best.sentence.text.length < 80 && nextSentence) {
    parts.push(nextSentence.sentence.text);
  }
  return parts.join(" ").trim();
}
function toMatch(queryProfile, entry, score, matchedTerms, scoreBreakdown) {
  return {
    id: entry.entry.id,
    title: entry.entry.title,
    source: entry.entry.source,
    chunk: pickBestChunk(queryProfile, entry),
    score,
    category: entry.entry.category,
    domain: entry.entry.domain,
    matched_terms: matchedTerms,
    score_breakdown: scoreBreakdown
  };
}
async function retrieveRagMatches(input) {
  if (!RAG_ENABLED) {
    return {
      enabled: false,
      retriever: "hybrid",
      items: [],
      reason: "RAG is disabled by configuration."
    };
  }
  const indexedCorpus = await loadIndexedCorpus();
  if (indexedCorpus.length === 0) {
    return {
      enabled: true,
      retriever: "hybrid",
      items: [],
      reason: "RAG corpus is empty."
    };
  }
  const normalizedQuery = await normalizeRagQuery({
    question: input.question,
    routeType: input.routeType
  });
  const effectiveQuestion = normalizedQuery.normalized_query || input.question;
  const queryProfile = buildTextProfile(effectiveQuestion);
  const experimentConfig = resolveRagExperimentConfig(input.experiment);
  const requestedLimit = input.limit ?? 3;
  const candidateLimit = experimentConfig.rerankEnabled || experimentConfig.embeddingCacheEnabled ? Math.max(requestedLimit, experimentConfig.candidateLimit) : requestedLimit;
  const ranked = indexedCorpus.map((entry) => {
    const scored = scoreEntry(queryProfile, input.routeType, entry);
    return {
      entry,
      ...scored
    };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, candidateLimit).map(
    (item) => toMatch(
      queryProfile,
      item.entry,
      item.score,
      item.matchedTerms,
      item.scoreBreakdown
    )
  );
  if (!experimentConfig.rerankEnabled) {
    return {
      enabled: true,
      retriever: "hybrid",
      items: ranked.slice(0, requestedLimit),
      reason: ranked.length === 0 ? "No matching knowledge entries were found. \u672A\u627E\u5230\u76F8\u5173\u77E5\u8BC6\u6761\u76EE\uFF0C\u4F46\u6211\u4ECD\u7136\u53EF\u4EE5\u5C1D\u8BD5\u56DE\u7B54\u60A8\u7684\u95EE\u9898\u3002" : void 0,
      experiment: experimentConfig.embeddingCacheEnabled ? {
        enabled: true,
        applied: false,
        strategy: "embedding-cache-rerank",
        provider: experimentConfig.embeddingProvider,
        model: experimentConfig.embeddingModel,
        cache_path: experimentConfig.embeddingCachePath,
        candidate_count: ranked.length,
        rescored_count: 0,
        reason: "Rerank is disabled."
      } : void 0
    };
  }
  const reranked = await applyOptionalRerank({
    question: effectiveQuestion,
    limit: requestedLimit,
    baselineItems: ranked,
    corpusEntriesById: new Map(indexedCorpus.map((entry) => [entry.entry.id, entry.entry])),
    experiment: input.experiment
  });
  return {
    enabled: true,
    retriever: reranked.retriever,
    items: reranked.items,
    reason: reranked.items.length === 0 ? "No matching knowledge entries were found. \u672A\u627E\u5230\u76F8\u5173\u77E5\u8BC6\u6761\u76EE\uFF0C\u4F46\u6211\u4ECD\u7136\u53EF\u4EE5\u5C1D\u8BD5\u56DE\u7B54\u60A8\u7684\u95EE\u9898\u3002" : void 0,
    experiment: reranked.experiment
  };
}

function buildAnswerDraft(items) {
  const [primary, secondary] = items;
  if (!primary) {
    return void 0;
  }
  const primarySentence = `${primary.title}\uFF1A${primary.chunk}`;
  if (!secondary || secondary.id === primary.id) {
    return primarySentence;
  }
  return `${primarySentence} \u8865\u5145\u8BF4\u660E\uFF1A${secondary.title}\uFF1A${secondary.chunk}`;
}
async function runRagTool(ctx, routeType) {
  const retrieval = await retrieveRagMatches({
    question: ctx.question,
    routeType,
    limit: 3
  });
  writeStructuredLog("ask.rag", {
    question: ctx.question,
    route_type: routeType,
    retriever: retrieval.retriever,
    enabled: retrieval.enabled,
    matched: retrieval.items.length > 0,
    reason: retrieval.reason,
    knowledge_types: [...new Set(retrieval.items.map((item) => item.category))],
    experiment: retrieval.experiment,
    top_results: retrieval.items.map((item) => ({
      title: item.title,
      source: item.source,
      score: item.score,
      category: item.category,
      domain: item.domain,
      matched_terms: item.matched_terms,
      score_breakdown: item.score_breakdown,
      lexical_score: item.lexical_score,
      embedding_similarity: item.embedding_similarity
    })),
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  const payload = {
    enabled: retrieval.enabled,
    question: ctx.question,
    route_type: routeType,
    retriever: retrieval.retriever,
    items: retrieval.items,
    answer_draft: buildAnswerDraft(retrieval.items),
    reason: retrieval.reason,
    experiment: retrieval.experiment
  };
  return {
    tool: "retrieveKnowledge",
    args: {
      question: ctx.question,
      route_type: routeType,
      retriever: retrieval.retriever
    },
    data: payload,
    result_count: retrieval.items.length
  };
}

const retrieveKnowledgeTool = createTool({
  id: "retrieve-knowledge",
  description: "\u5728\u672C\u5730\u533B\u5B66\u77E5\u8BC6\u5E93(docs/rag)\u4E2D\u68C0\u7D22\uFF0C\u7528\u4E8E\u89E3\u91CA\u533B\u5B66\u672F\u8BED\u3001\u5316\u9A8C/\u4F53\u5F81\u6307\u6807\u542B\u4E49\u3001\u6570\u636E\u5B57\u6BB5\u542B\u4E49\u6216\u8BCA\u65AD\u76F8\u5173\u77E5\u8BC6\u3002\u5F53\u7528\u6237\u662F\u5728\u95EE\u300E\u8FD9\u4E2A\u6307\u6807/\u672F\u8BED/\u5B57\u6BB5\u662F\u4EC0\u4E48\u610F\u601D\u300F\u8FD9\u7C7B\u6982\u5FF5\u6027\u95EE\u9898\uFF08\u800C\u975E\u67E5\u8BE2\u67D0\u4F4D\u60A3\u8005\u7684\u5177\u4F53\u6570\u636E\uFF09\u65F6\u4F7F\u7528\u3002",
  inputSchema: z.object({
    question: z.string().min(1).describe("\u8981\u68C0\u7D22/\u89E3\u91CA\u7684\u95EE\u9898\u6216\u672F\u8BED\u3002")
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    retriever: z.string(),
    answer_draft: z.string().optional(),
    reason: z.string().optional(),
    items: z.array(z.record(z.string(), z.any()))
  }),
  execute: async (inputData) => {
    const result = await runRagTool(
      { question: inputData.question },
      "knowledge_query"
    );
    const payload = result.data;
    return {
      enabled: payload.enabled,
      retriever: payload.retriever,
      answer_draft: payload.answer_draft,
      reason: payload.reason,
      items: Array.isArray(payload.items) ? payload.items : []
    };
  }
});

export { retrieveKnowledgeTool };
