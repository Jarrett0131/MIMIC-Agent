import dotenv from 'dotenv';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';


// -- Shims --
import cjsUrl from 'node:url';
import cjsPath from 'node:path';
import cjsModule from 'node:module';
const __filename = cjsUrl.fileURLToPath(import.meta.url);
const __dirname = cjsPath.dirname(__filename);
const require = cjsModule.createRequire(import.meta.url);
dotenv.config({
  path: path.resolve(__dirname, "../../.env")
});
function readIntegerEnv(name, fallback, minimum = 0) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue) || parsedValue < minimum) {
    return fallback;
  }
  return parsedValue;
}
function readStringEnv(name, fallback = "") {
  const rawValue = process.env[name]?.trim();
  return rawValue && rawValue.length > 0 ? rawValue : fallback;
}
function readBooleanEnv(name, fallback) {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) {
    return fallback;
  }
  if (rawValue === "true" || rawValue === "1" || rawValue === "yes") {
    return true;
  }
  if (rawValue === "false" || rawValue === "0" || rawValue === "no") {
    return false;
  }
  return fallback;
}
function readStringListEnv(name, fallback = []) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }
  return rawValue.split(",").map((value) => value.trim().toLowerCase()).filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}
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
function resolveDefaultLlmFallbackProviders(provider) {
  if (provider === "deepseek") {
    return ["aliyun", "openai"];
  }
  if (provider === "aliyun") {
    return ["deepseek", "openai"];
  }
  return ["deepseek", "aliyun"];
}
const DEFAULT_PORT = 3001;
const DEFAULT_PYTHON_SERVICE_URL = "http://127.0.0.1:8000";
const DEFAULT_NODE_ENV = "development";
const DEFAULT_REQUEST_TIMEOUT_MS = 1e4;
const DEFAULT_RETRY_TIMES = 1;
const DEFAULT_LLM_PROVIDER = "deepseek";
const DEFAULT_LLM_TIMEOUT_MS = 8e3;
const DEFAULT_LLM_RETRY_TIMES = 1;
const DEFAULT_LLM_MAX_TOTAL_TOKENS = 0;
const DEFAULT_RAG_EMBEDDING_PROVIDER = "openai";
const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_RAG_EMBEDDING_CACHE_PATH = "../evaluation/cache/rag_embeddings.json";
const DEFAULT_RAG_RERANK_CANDIDATE_LIMIT = 8;
const DEFAULT_RAG_EMBEDDING_DIMENSIONS = 96;
const pythonServiceUrl = process.env.PYTHON_SERVICE_URL?.trim() || process.env.PYTHON_SERVICE_BASE_URL?.trim() || DEFAULT_PYTHON_SERVICE_URL;
const llmProvider = readStringEnv("LLM_PROVIDER", DEFAULT_LLM_PROVIDER).toLowerCase();
const llmBaseUrl = readStringEnv(
  "LLM_BASE_URL",
  readStringEnv("OPENAI_BASE_URL", resolveDefaultLlmBaseUrl(llmProvider))
);
const llmApiKey = readStringEnv(
  "LLM_API_KEY",
  readStringEnv(
    "DEEPSEEK_API_KEY",
    readStringEnv("DASHSCOPE_API_KEY", readStringEnv("OPENAI_API_KEY"))
  )
);
const llmModel = readStringEnv(
  "LLM_MODEL",
  readStringEnv("OPENAI_MODEL", resolveDefaultLlmModel(llmProvider))
);
const llmFallbackProviders = readStringListEnv(
  "LLM_FALLBACK_PROVIDERS",
  resolveDefaultLlmFallbackProviders(llmProvider)
).filter((provider) => provider !== llmProvider);
const config = Object.freeze({
  nodeEnv: readStringEnv("NODE_ENV", DEFAULT_NODE_ENV),
  port: readIntegerEnv("PORT", DEFAULT_PORT, 1),
  pythonServiceUrl,
  requestTimeoutMs: readIntegerEnv(
    "REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
    1
  ),
  retryTimes: readIntegerEnv("RETRY_TIMES", DEFAULT_RETRY_TIMES, 0),
  llmEnabled: readBooleanEnv("LLM_ENABLED", false),
  llmProvider,
  llmApiKey,
  llmModel,
  llmBaseUrl,
  llmTimeoutMs: readIntegerEnv("LLM_TIMEOUT_MS", DEFAULT_LLM_TIMEOUT_MS, 1),
  llmRetryTimes: readIntegerEnv("LLM_RETRY_TIMES", DEFAULT_LLM_RETRY_TIMES, 0),
  llmFallbackProviders,
  llmMaxTotalTokens: readIntegerEnv(
    "LLM_MAX_TOTAL_TOKENS",
    DEFAULT_LLM_MAX_TOTAL_TOKENS,
    0
  ),
  queryRewriteEnabled: readBooleanEnv("QUERY_REWRITE_ENABLED", true),
  answerEnhancementEnabled: readBooleanEnv("ANSWER_ENHANCEMENT_ENABLED", true),
  ragLlmQueryEnabled: readBooleanEnv("RAG_LLM_QUERY_ENABLED", false),
  ragEnabled: readBooleanEnv("RAG_ENABLED", true),
  ragRerankEnabled: readBooleanEnv("RAG_RERANK_ENABLED", false),
  ragEmbeddingCacheEnabled: readBooleanEnv("RAG_EMBEDDING_CACHE_ENABLED", false),
  ragEmbeddingProvider: readStringEnv(
    "RAG_EMBEDDING_PROVIDER",
    DEFAULT_RAG_EMBEDDING_PROVIDER
  ).toLowerCase(),
  ragEmbeddingModel: readStringEnv(
    "RAG_EMBEDDING_MODEL",
    DEFAULT_RAG_EMBEDDING_MODEL
  ),
  ragEmbeddingCachePath: readStringEnv(
    "RAG_EMBEDDING_CACHE_PATH",
    DEFAULT_RAG_EMBEDDING_CACHE_PATH
  ),
  ragRerankCandidateLimit: readIntegerEnv(
    "RAG_RERANK_CANDIDATE_LIMIT",
    DEFAULT_RAG_RERANK_CANDIDATE_LIMIT,
    1
  ),
  ragEmbeddingDimensions: readIntegerEnv(
    "RAG_EMBEDDING_DIMENSIONS",
    DEFAULT_RAG_EMBEDDING_DIMENSIONS,
    8
  )
});
const PYTHON_SERVICE_URL = config.pythonServiceUrl;
const REQUEST_TIMEOUT_MS = config.requestTimeoutMs;
const RETRY_TIMES = config.retryTimes;
const LLM_ENABLED = config.llmEnabled;
const LLM_PROVIDER = config.llmProvider;
const LLM_API_KEY = config.llmApiKey;
const LLM_MODEL = config.llmModel;
const LLM_BASE_URL = config.llmBaseUrl;
const LLM_TIMEOUT_MS = config.llmTimeoutMs;
const LLM_RETRY_TIMES = config.llmRetryTimes;
const LLM_FALLBACK_PROVIDERS = config.llmFallbackProviders;
const LLM_MAX_TOTAL_TOKENS = config.llmMaxTotalTokens;
const RAG_LLM_QUERY_ENABLED = config.ragLlmQueryEnabled;
const RAG_ENABLED = config.ragEnabled;
const RAG_RERANK_ENABLED = config.ragRerankEnabled;
const RAG_EMBEDDING_CACHE_ENABLED = config.ragEmbeddingCacheEnabled;
const RAG_EMBEDDING_PROVIDER = config.ragEmbeddingProvider;
const RAG_EMBEDDING_MODEL = config.ragEmbeddingModel;
const RAG_EMBEDDING_CACHE_PATH = config.ragEmbeddingCachePath;
const RAG_RERANK_CANDIDATE_LIMIT = config.ragRerankCandidateLimit;
const RAG_EMBEDDING_DIMENSIONS = config.ragEmbeddingDimensions;

const requestContextStorage = new AsyncLocalStorage();
function getRequestContext() {
  return requestContextStorage.getStore();
}
function recordRetryEvent(entry) {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }
  store.retries.push({
    ...entry,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function recordLlmCallEvent(entry) {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }
  store.llmCalls.push({
    ...entry,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}

function writeStructuredLog(event, payload = {}) {
  const requestContext = getRequestContext();
  console.log(
    JSON.stringify({
      event,
      request_id: payload.request_id ?? requestContext?.requestId,
      ...payload
    })
  );
}

export { LLM_ENABLED as L, PYTHON_SERVICE_URL as P, RETRY_TIMES as R, REQUEST_TIMEOUT_MS as a, LLM_MAX_TOTAL_TOKENS as b, LLM_RETRY_TIMES as c, LLM_TIMEOUT_MS as d, LLM_MODEL as e, LLM_PROVIDER as f, getRequestContext as g, LLM_FALLBACK_PROVIDERS as h, recordLlmCallEvent as i, LLM_API_KEY as j, LLM_BASE_URL as k, RAG_LLM_QUERY_ENABLED as l, RAG_EMBEDDING_DIMENSIONS as m, RAG_RERANK_CANDIDATE_LIMIT as n, RAG_EMBEDDING_MODEL as o, RAG_EMBEDDING_PROVIDER as p, RAG_EMBEDDING_CACHE_ENABLED as q, recordRetryEvent as r, RAG_RERANK_ENABLED as s, RAG_EMBEDDING_CACHE_PATH as t, RAG_ENABLED as u, writeStructuredLog as w };
