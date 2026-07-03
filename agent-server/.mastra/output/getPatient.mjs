import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
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

class AgentError extends Error {
  constructor(code, message, source, detail, status) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.source = source;
    this.detail = detail;
    this.status = status;
  }
}

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

class PythonClientError extends AgentError {
  constructor(message, status) {
    super("PYTHON_SERVICE_ERROR", message, "python-service", void 0, status);
    this.name = "PythonClientError";
    this.status = status;
  }
}
const httpClient = axios.create({
  baseURL: PYTHON_SERVICE_URL,
  timeout: REQUEST_TIMEOUT_MS
});
const ACTION_LABELS = {
  fetchPatient: "Fetch patient overview",
  fetchPatientIds: "Fetch patient ids",
  fetchDiagnoses: "Fetch diagnoses",
  fetchRecentLabs: "Fetch recent labs",
  fetchRecentVitals: "Fetch recent vitals",
  importClinicalData: "Import external clinical data",
  importClinicalCsvData: "Import external clinical CSV data",
  importClinicalExcelData: "Import external clinical Excel data",
  fetchClinicalImportHistory: "Fetch clinical import history",
  deleteClinicalImport: "Delete imported clinical dataset",
  fetchPythonHealth: "Check Python service health"
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function shouldRetryRequest(error) {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  if (!error.response) {
    return true;
  }
  return status === 408 || status === 429 || typeof status === "number" && status >= 500;
}
function getActionLabel(action) {
  return ACTION_LABELS[action] ?? action;
}
function buildErrorMessage(action, error) {
  const actionLabel = getActionLabel(action);
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const noResponse = !error.response;
    const detail = isRecord(responseData) && typeof responseData.detail === "string" ? responseData.detail : isRecord(responseData) && typeof responseData.error === "string" ? responseData.error : noResponse ? `Python data-service is unreachable: ${PYTHON_SERVICE_URL}` : error.message;
    return new PythonClientError(
      `${actionLabel} failed${status ? ` (status ${status})` : ""}: ${detail}`,
      status ?? (noResponse ? 502 : void 0)
    );
  }
  if (error instanceof Error) {
    return new PythonClientError(`${actionLabel} failed: ${error.message}`);
  }
  return new PythonClientError(`${actionLabel} failed: unknown error`);
}
async function withRetry(action, request) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      const shouldRetry = shouldRetryRequest(error) && attempt < RETRY_TIMES;
      if (!shouldRetry) {
        throw buildErrorMessage(action, error);
      }
      const requestContext = getRequestContext();
      const status = axios.isAxiosError(error) && typeof error.response?.status === "number" ? error.response.status : void 0;
      const message = error instanceof Error && error.message.trim() ? error.message : "Unknown upstream error";
      const retryAttempt = attempt + 1;
      recordRetryEvent({
        action,
        attempt: retryAttempt,
        max_attempts: RETRY_TIMES + 1,
        status,
        message
      });
      writeStructuredLog("python.retry", {
        request_id: requestContext?.requestId,
        action,
        attempt: retryAttempt,
        max_attempts: RETRY_TIMES + 1,
        status,
        message,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  throw buildErrorMessage(action, lastError);
}
async function fetchPatient(hadmId) {
  return withRetry("fetchPatient", async () => {
    const response = await httpClient.get(`/patient/${hadmId}`);
    return response.data;
  });
}
async function fetchDiagnoses(hadmId) {
  return withRetry("fetchDiagnoses", async () => {
    const response = await httpClient.get(`/diagnoses/${hadmId}`);
    return response.data;
  });
}
async function fetchRecentLabs(hadmId, keyword, limit = 10) {
  return withRetry("fetchRecentLabs", async () => {
    const response = await httpClient.get("/labs/recent", {
      params: {
        hadm_id: hadmId,
        keyword,
        limit
      }
    });
    return response.data;
  });
}
async function fetchRecentVitals(hadmId, keyword, limit = 10) {
  return withRetry("fetchRecentVitals", async () => {
    const response = await httpClient.get("/vitals/recent", {
      params: {
        hadm_id: hadmId,
        keyword,
        limit
      }
    });
    return response.data;
  });
}

const getPatientTool = createTool({
  id: "get-patient",
  description: "\u6839\u636E\u4F4F\u9662 ID (hadm_id) \u83B7\u53D6\u8BE5\u60A3\u8005\u7684\u7ED3\u6784\u5316\u6982\u51B5\uFF0C\u5305\u62EC\u4EBA\u53E3\u5B66\u4FE1\u606F\u3001\u5165\u9662/\u51FA\u9662\u65F6\u95F4\u3001ICU \u51FA\u5165\u5BA4\u65F6\u95F4\u4EE5\u53CA\u5DF2\u8BB0\u5F55\u7684\u8BCA\u65AD\u3002\u6570\u636E\u6765\u81EA MIMIC-IV data-service\uFF0C\u4E0D\u5305\u542B\u5316\u9A8C\u6216\u751F\u547D\u4F53\u5F81\u660E\u7EC6\u3002",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("\u60A3\u8005\u4F4F\u9662 ID (hadm_id)\uFF0C\u6B63\u6574\u6570\u3002")
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    patient_overview: z.record(z.string(), z.any()),
    diagnoses: z.array(z.record(z.string(), z.any()))
  }),
  execute: async (inputData) => {
    const data = await fetchPatient(inputData.hadm_id);
    return {
      hadm_id: data.hadm_id,
      patient_overview: data.patient_overview ?? {},
      diagnoses: Array.isArray(data.diagnoses) ? data.diagnoses : []
    };
  }
});

export { LLM_ENABLED as L, RAG_LLM_QUERY_ENABLED as R, fetchRecentLabs as a, fetchRecentVitals as b, LLM_MAX_TOTAL_TOKENS as c, LLM_RETRY_TIMES as d, LLM_TIMEOUT_MS as e, fetchDiagnoses as f, LLM_MODEL as g, LLM_PROVIDER as h, LLM_FALLBACK_PROVIDERS as i, LLM_API_KEY as j, LLM_BASE_URL as k, RAG_EMBEDDING_DIMENSIONS as l, RAG_RERANK_CANDIDATE_LIMIT as m, RAG_EMBEDDING_MODEL as n, RAG_EMBEDDING_PROVIDER as o, RAG_EMBEDDING_CACHE_ENABLED as p, RAG_RERANK_ENABLED as q, recordLlmCallEvent as r, RAG_EMBEDDING_CACHE_PATH as s, RAG_ENABLED as t, getPatientTool as u, writeStructuredLog as w };
