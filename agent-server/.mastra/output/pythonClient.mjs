import axios from 'axios';
import { R as RETRY_TIMES, g as getRequestContext, r as recordRetryEvent, w as writeStructuredLog, P as PYTHON_SERVICE_URL, a as REQUEST_TIMEOUT_MS } from './logger.mjs';

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

export { fetchRecentLabs as a, fetchPatient as b, fetchRecentVitals as c, fetchDiagnoses as f };
