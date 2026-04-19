import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

function readIntegerEnv(name: string, fallback: number, minimum = 0): number {
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

function readStringEnv(name: string, fallback = ""): string {
  const rawValue = process.env[name]?.trim();
  return rawValue && rawValue.length > 0 ? rawValue : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
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

function readStringListEnv(name: string, fallback: string[] = []): string[] {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }

  return rawValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function resolveDefaultLlmBaseUrl(provider: string): string {
  if (provider === "aliyun") {
    return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }

  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }

  return "https://api.openai.com/v1";
}

function resolveDefaultLlmModel(provider: string): string {
  if (provider === "aliyun") {
    return "qwen-plus";
  }

  if (provider === "deepseek") {
    return "deepseek-chat";
  }

  return "gpt-4.1-mini";
}

function resolveDefaultLlmFallbackProviders(provider: string): string[] {
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
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_TIMES = 1;
const DEFAULT_LLM_PROVIDER = "deepseek";
const DEFAULT_LLM_TIMEOUT_MS = 8_000;
const DEFAULT_LLM_RETRY_TIMES = 1;
const DEFAULT_LLM_MAX_TOTAL_TOKENS = 0;
const DEFAULT_RAG_EMBEDDING_PROVIDER = "openai";
const DEFAULT_RAG_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_RAG_EMBEDDING_CACHE_PATH = "../evaluation/cache/rag_embeddings.json";
const DEFAULT_RAG_RERANK_CANDIDATE_LIMIT = 8;
const DEFAULT_RAG_EMBEDDING_DIMENSIONS = 96;

const pythonServiceUrl =
  process.env.PYTHON_SERVICE_URL?.trim() ||
  process.env.PYTHON_SERVICE_BASE_URL?.trim() ||
  DEFAULT_PYTHON_SERVICE_URL;

const llmProvider = readStringEnv("LLM_PROVIDER", DEFAULT_LLM_PROVIDER).toLowerCase();
const llmBaseUrl = readStringEnv(
  "LLM_BASE_URL",
  readStringEnv("OPENAI_BASE_URL", resolveDefaultLlmBaseUrl(llmProvider)),
);
const llmApiKey = readStringEnv(
  "LLM_API_KEY",
  readStringEnv(
    "DEEPSEEK_API_KEY",
    readStringEnv("DASHSCOPE_API_KEY", readStringEnv("OPENAI_API_KEY")),
  ),
);
const llmModel = readStringEnv(
  "LLM_MODEL",
  readStringEnv("OPENAI_MODEL", resolveDefaultLlmModel(llmProvider)),
);
const llmFallbackProviders = readStringListEnv(
  "LLM_FALLBACK_PROVIDERS",
  resolveDefaultLlmFallbackProviders(llmProvider),
).filter((provider) => provider !== llmProvider);

export const config = Object.freeze({
  nodeEnv: readStringEnv("NODE_ENV", DEFAULT_NODE_ENV),
  port: readIntegerEnv("PORT", DEFAULT_PORT, 1),
  pythonServiceUrl,
  requestTimeoutMs: readIntegerEnv(
    "REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
    1,
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
    0,
  ),
  queryRewriteEnabled: readBooleanEnv("QUERY_REWRITE_ENABLED", true),
  answerEnhancementEnabled: readBooleanEnv("ANSWER_ENHANCEMENT_ENABLED", true),
  ragLlmQueryEnabled: readBooleanEnv("RAG_LLM_QUERY_ENABLED", false),
  ragEnabled: readBooleanEnv("RAG_ENABLED", true),
  ragRerankEnabled: readBooleanEnv("RAG_RERANK_ENABLED", false),
  ragEmbeddingCacheEnabled: readBooleanEnv("RAG_EMBEDDING_CACHE_ENABLED", false),
  ragEmbeddingProvider: readStringEnv(
    "RAG_EMBEDDING_PROVIDER",
    DEFAULT_RAG_EMBEDDING_PROVIDER,
  ).toLowerCase(),
  ragEmbeddingModel: readStringEnv(
    "RAG_EMBEDDING_MODEL",
    DEFAULT_RAG_EMBEDDING_MODEL,
  ),
  ragEmbeddingCachePath: readStringEnv(
    "RAG_EMBEDDING_CACHE_PATH",
    DEFAULT_RAG_EMBEDDING_CACHE_PATH,
  ),
  ragRerankCandidateLimit: readIntegerEnv(
    "RAG_RERANK_CANDIDATE_LIMIT",
    DEFAULT_RAG_RERANK_CANDIDATE_LIMIT,
    1,
  ),
  ragEmbeddingDimensions: readIntegerEnv(
    "RAG_EMBEDDING_DIMENSIONS",
    DEFAULT_RAG_EMBEDDING_DIMENSIONS,
    8,
  ),
});

export const NODE_ENV = config.nodeEnv;
export const PORT = config.port;
export const PYTHON_SERVICE_URL = config.pythonServiceUrl;
export const REQUEST_TIMEOUT_MS = config.requestTimeoutMs;
export const RETRY_TIMES = config.retryTimes;
export const LLM_ENABLED = config.llmEnabled;
export const LLM_PROVIDER = config.llmProvider;
export const LLM_API_KEY = config.llmApiKey;
export const LLM_MODEL = config.llmModel;
export const LLM_BASE_URL = config.llmBaseUrl;
export const LLM_TIMEOUT_MS = config.llmTimeoutMs;
export const LLM_RETRY_TIMES = config.llmRetryTimes;
export const LLM_FALLBACK_PROVIDERS = config.llmFallbackProviders;
export const LLM_MAX_TOTAL_TOKENS = config.llmMaxTotalTokens;
export const QUERY_REWRITE_ENABLED = config.queryRewriteEnabled;
export const ANSWER_ENHANCEMENT_ENABLED = config.answerEnhancementEnabled;
export const RAG_LLM_QUERY_ENABLED = config.ragLlmQueryEnabled;
export const RAG_ENABLED = config.ragEnabled;
export const RAG_RERANK_ENABLED = config.ragRerankEnabled;
export const RAG_EMBEDDING_CACHE_ENABLED = config.ragEmbeddingCacheEnabled;
export const RAG_EMBEDDING_PROVIDER = config.ragEmbeddingProvider;
export const RAG_EMBEDDING_MODEL = config.ragEmbeddingModel;
export const RAG_EMBEDDING_CACHE_PATH = config.ragEmbeddingCachePath;
export const RAG_RERANK_CANDIDATE_LIMIT = config.ragRerankCandidateLimit;
export const RAG_EMBEDDING_DIMENSIONS = config.ragEmbeddingDimensions;
