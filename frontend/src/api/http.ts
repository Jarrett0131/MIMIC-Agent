import { appConfig } from "../config/app";
import type { HttpErrorBody } from "../types";

export function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}

export function buildConnectionError(): Error {
  return new Error(`无法连接到 ${appConfig.agentServerUrl} 上的 agent-server。`);
}

export function parseErrorMessage(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as HttpErrorBody;
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      return body.error;
    }
    if (typeof body.detail === "string" && body.detail.trim().length > 0) {
      return body.detail;
    }
    if (typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    // Ignore invalid JSON payloads and fall back to plain text.
  }

  return text.trim() || `请求失败，状态码 ${status}。`;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseErrorMessage(text, response.status));
  }

  return JSON.parse(text) as T;
}
