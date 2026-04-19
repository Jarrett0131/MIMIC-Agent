import { appConfig } from "../config/app";
import type { LabRecordsResponse, VitalRecordsResponse } from "../types";
import { buildConnectionError, isAbortError, parseJsonResponse } from "./http";

async function fetchDashboardData<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${appConfig.agentServerUrl}${path}`, {
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

  return parseJsonResponse<T>(response);
}

export async function fetchRecentLabs(
  hadmId: number,
  keyword: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<LabRecordsResponse> {
  const params = new URLSearchParams({
    hadm_id: String(hadmId),
    keyword,
    limit: String(limit),
  });

  return fetchDashboardData<LabRecordsResponse>(`/labs/recent?${params.toString()}`, signal);
}

export async function fetchRecentVitals(
  hadmId: number,
  keyword: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<VitalRecordsResponse> {
  const params = new URLSearchParams({
    hadm_id: String(hadmId),
    keyword,
    limit: String(limit),
  });

  return fetchDashboardData<VitalRecordsResponse>(
    `/vitals/recent?${params.toString()}`,
    signal,
  );
}
