import axios from "axios";

import { PYTHON_SERVICE_URL, REQUEST_TIMEOUT_MS, RETRY_TIMES } from "../config";
import { AgentError } from "../core/errors/AgentError";
import { writeStructuredLog } from "../logging/logger";
import { getRequestContext, recordRetryEvent } from "../logging/requestContext";
import type {
  ClinicalDataCsvImportRequest,
  ClinicalDataExcelImportRequest,
  ClinicalDataImportRequest,
  ClinicalDataImportListResponse,
  ClinicalDataImportResponse,
  DiagnosesResponse,
  LabRecordsResponse,
  PatientIdListResponse,
  PatientOverviewResponse,
  VitalRecordsResponse,
} from "../types";

export class PythonClientError extends AgentError {
  public readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super("PYTHON_SERVICE_ERROR", message, "python-service", undefined, status);
    this.name = "PythonClientError";
    this.status = status;
  }
}

const httpClient = axios.create({
  baseURL: PYTHON_SERVICE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

const ACTION_LABELS: Record<string, string> = {
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
  fetchPythonHealth: "Check Python service health",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldRetryRequest(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  if (!error.response) {
    return true;
  }

  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function buildErrorMessage(action: string, error: unknown): PythonClientError {
  const actionLabel = getActionLabel(action);

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const responseData = error.response?.data;
    const noResponse = !error.response;
    const detail =
      isRecord(responseData) && typeof responseData.detail === "string"
        ? responseData.detail
        : isRecord(responseData) && typeof responseData.error === "string"
          ? responseData.error
          : noResponse
            ? `Python data-service is unreachable: ${PYTHON_SERVICE_URL}`
            : error.message;

    return new PythonClientError(
      `${actionLabel} failed${status ? ` (status ${status})` : ""}: ${detail}`,
      status ?? (noResponse ? 502 : undefined),
    );
  }

  if (error instanceof Error) {
    return new PythonClientError(`${actionLabel} failed: ${error.message}`);
  }

  return new PythonClientError(`${actionLabel} failed: unknown error`);
}

async function withRetry<T>(action: string, request: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_TIMES; attempt += 1) {
    try {
      return await request();
    } catch (error: unknown) {
      lastError = error;

      const shouldRetry = shouldRetryRequest(error) && attempt < RETRY_TIMES;
      if (!shouldRetry) {
        throw buildErrorMessage(action, error);
      }

      const requestContext = getRequestContext();
      const status =
        axios.isAxiosError(error) && typeof error.response?.status === "number"
          ? error.response.status
          : undefined;
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unknown upstream error";
      const retryAttempt = attempt + 1;

      recordRetryEvent({
        action,
        attempt: retryAttempt,
        max_attempts: RETRY_TIMES + 1,
        status,
        message,
      });

      writeStructuredLog("python.retry", {
        request_id: requestContext?.requestId,
        action,
        attempt: retryAttempt,
        max_attempts: RETRY_TIMES + 1,
        status,
        message,
        created_at: new Date().toISOString(),
      });
    }
  }

  throw buildErrorMessage(action, lastError);
}

export async function fetchPatient(hadmId: number): Promise<PatientOverviewResponse> {
  return withRetry("fetchPatient", async () => {
    const response = await httpClient.get<PatientOverviewResponse>(`/patient/${hadmId}`);
    return response.data;
  });
}

export async function fetchPatientIds(): Promise<PatientIdListResponse> {
  return withRetry("fetchPatientIds", async () => {
    const response = await httpClient.get<PatientIdListResponse>("/patients/ids");
    return response.data;
  });
}

export async function fetchDiagnoses(hadmId: number): Promise<DiagnosesResponse> {
  return withRetry("fetchDiagnoses", async () => {
    const response = await httpClient.get<DiagnosesResponse>(`/diagnoses/${hadmId}`);
    return response.data;
  });
}

export async function fetchRecentLabs(
  hadmId: number,
  keyword: string,
  limit = 10,
): Promise<LabRecordsResponse> {
  return withRetry("fetchRecentLabs", async () => {
    const response = await httpClient.get<LabRecordsResponse>("/labs/recent", {
      params: {
        hadm_id: hadmId,
        keyword,
        limit,
      },
    });
    return response.data;
  });
}

export async function fetchRecentVitals(
  hadmId: number,
  keyword: string,
  limit = 10,
): Promise<VitalRecordsResponse> {
  return withRetry("fetchRecentVitals", async () => {
    const response = await httpClient.get<VitalRecordsResponse>("/vitals/recent", {
      params: {
        hadm_id: hadmId,
        keyword,
        limit,
      },
    });
    return response.data;
  });
}

export async function fetchPythonHealth(): Promise<Record<string, unknown>> {
  return withRetry("fetchPythonHealth", async () => {
    const response = await httpClient.get<Record<string, unknown>>("/health");
    return response.data;
  });
}

export async function importClinicalData(
  payload: ClinicalDataImportRequest,
): Promise<ClinicalDataImportResponse> {
  return withRetry("importClinicalData", async () => {
    const response = await httpClient.post<ClinicalDataImportResponse>(
      "/imports/clinical-data",
      payload,
    );
    return response.data;
  });
}

export async function importClinicalCsvData(
  payload: ClinicalDataCsvImportRequest,
): Promise<ClinicalDataImportResponse> {
  return withRetry("importClinicalCsvData", async () => {
    const response = await httpClient.post<ClinicalDataImportResponse>(
      "/imports/clinical-data/csv",
      payload,
    );
    return response.data;
  });
}

export async function importClinicalExcelData(
  payload: ClinicalDataExcelImportRequest,
): Promise<ClinicalDataImportResponse> {
  return withRetry("importClinicalExcelData", async () => {
    const response = await httpClient.post<ClinicalDataImportResponse>(
      "/imports/clinical-data/excel",
      payload,
    );
    return response.data;
  });
}

export async function fetchClinicalImportHistory(): Promise<ClinicalDataImportListResponse> {
  return withRetry("fetchClinicalImportHistory", async () => {
    const response = await httpClient.get<ClinicalDataImportListResponse>("/imports/clinical-data");
    return response.data;
  });
}

export async function deleteClinicalImport(
  importId: string,
): Promise<ClinicalDataImportResponse> {
  return withRetry("deleteClinicalImport", async () => {
    const response = await httpClient.delete<ClinicalDataImportResponse>(
      `/imports/clinical-data/${encodeURIComponent(importId)}`,
    );
    return response.data;
  });
}
