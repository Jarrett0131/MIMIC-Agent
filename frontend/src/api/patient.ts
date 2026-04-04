import { requestJson } from "./client";
import type { PatientOverviewResponse } from "../types";

/**
 * GET /patient/{hadm_id}
 */
export function fetchPatientOverview(
  hadm_id: number
): Promise<PatientOverviewResponse> {
  return requestJson<PatientOverviewResponse>(`/patient/${hadm_id}`);
}
