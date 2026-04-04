/**
 * 共享 fetch 封装：统一 base URL 与错误解析。
 */

import type { HttpErrorBody } from "../types";

function getApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, "");
  }
  return "/api";
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function parseErrorBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function formatApiErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as HttpErrorBody).detail;
    if (typeof detail === "string") return detail;
    return JSON.stringify(detail);
  }
  return `请求失败（HTTP ${status}）`;
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBase();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await parseErrorBody(res);
    throw new ApiError(formatApiErrorMessage(res.status, body), res.status, body);
  }
  return (await res.json()) as T;
}
