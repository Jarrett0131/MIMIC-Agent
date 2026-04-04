import { requestJson } from "./client";
import type { AskRequest, AskResponse } from "../types";

/**
 * POST /ask
 */
export function askQuestion(body: AskRequest): Promise<AskResponse> {
  return requestJson<AskResponse>("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
