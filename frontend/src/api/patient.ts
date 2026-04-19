import { appConfig } from "../config/app";
import type { PatientIdListResponse, PatientOverviewResponse } from "../types";
import { buildConnectionError, isAbortError, parseJsonResponse } from "./http";

export async function fetchPatient(hadmId: number): Promise<PatientOverviewResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/patient/${hadmId}`, {
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    throw buildConnectionError();
  }

  return parseJsonResponse<PatientOverviewResponse>(response);
}

export async function fetchPatientIds(signal?: AbortSignal): Promise<PatientIdListResponse> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}/patients/ids`, {
      headers: {
        Accept: "application/json",
      },
      signal,
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw error;
    }

    throw buildConnectionError();
  }

  return parseJsonResponse<PatientIdListResponse>(response);
}
