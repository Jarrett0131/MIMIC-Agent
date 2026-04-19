import type { AskPipelineDiagnostics, AskResponse } from "../types";
import { writeStructuredLog } from "./logger";
import { getRequestContext, type RetryEvent } from "./requestContext";

export type AskLog = {
  request_id: string;
  hadm_id: string;
  question: string;
  question_type?: string | null;
  route_type?: string | null;
  tool_trace: unknown[];
  total_duration_ms: number;
  success: boolean;
  error_code?: string;
  created_at: string;
  retry_count?: number;
  retries?: RetryEvent[];
  enhancement?: AskResponse["enhancement"];
  pipeline: AskPipelineDiagnostics;
};

type BuildAskLogEntryArgs = {
  requestId: string;
  hadmId: number | string;
  question: string;
  response: AskResponse;
  diagnostics: AskPipelineDiagnostics;
  totalDurationMs: number;
  createdAt: string;
};

export function buildAskLogEntry({
  requestId,
  hadmId,
  question,
  response,
  diagnostics,
  totalDurationMs,
  createdAt,
}: BuildAskLogEntryArgs): AskLog {
  const requestContext = getRequestContext();

  return {
    request_id: requestId,
    hadm_id: String(hadmId),
    question,
    question_type: response.question_type,
    route_type: response.routing?.route_type ?? null,
    tool_trace: response.tool_trace,
    total_duration_ms: totalDurationMs,
    success: response.success,
    error_code: response.error?.code,
    created_at: createdAt,
    retry_count: requestContext?.retries.length ?? 0,
    retries: requestContext?.retries ?? [],
    enhancement: response.enhancement,
    pipeline: diagnostics,
  };
}

export function logAskRequest(entry: AskLog): void {
  writeStructuredLog("ask.request", entry);
}
