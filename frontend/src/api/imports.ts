import { appConfig } from "../config/app";
import type {
  ClinicalDataCsvImportRequest,
  ClinicalDataExcelImportRequest,
  ClinicalDataImportRequest,
  ClinicalDataImportListResponse,
  ClinicalDataImportResponse,
} from "../types";
import { buildConnectionError, parseJsonResponse } from "./http";

export async function importClinicalData(
  payload: ClinicalDataImportRequest,
): Promise<ClinicalDataImportResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/imports/clinical-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<ClinicalDataImportResponse>(response);
}

export async function importClinicalCsvData(
  payload: ClinicalDataCsvImportRequest,
): Promise<ClinicalDataImportResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/imports/clinical-data/csv`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<ClinicalDataImportResponse>(response);
}

export async function importClinicalExcelData(
  payload: ClinicalDataExcelImportRequest,
): Promise<ClinicalDataImportResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/imports/clinical-data/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<ClinicalDataImportResponse>(response);
}

export async function fetchClinicalImportHistory(): Promise<ClinicalDataImportListResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/imports/clinical-data`, {
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<ClinicalDataImportListResponse>(response);
}

export async function deleteClinicalImport(importId: string): Promise<ClinicalDataImportResponse> {
  let response: Response;

  try {
    response = await fetch(
      `${appConfig.agentServerUrl}/imports/clinical-data/${encodeURIComponent(importId)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/json",
        },
      },
    );
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<ClinicalDataImportResponse>(response);
}
