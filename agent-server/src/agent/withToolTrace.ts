import type { ToolResult } from "./toolRegistry";
import type { ToolTraceItem } from "../types";

type TracedToolExecution<T> = {
  trace: ToolTraceItem;
  data?: T;
  error?: unknown;
};

function inferResultCount(data: unknown): number | undefined {
  if (Array.isArray(data)) {
    return data.length;
  }

  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  if (
    "patient_overview" in data &&
    typeof (data as { patient_overview?: unknown }).patient_overview === "object" &&
    (data as { patient_overview?: unknown }).patient_overview !== null
  ) {
    return 1;
  }

  if (
    "result_count" in data &&
    typeof (data as { result_count?: unknown }).result_count === "number"
  ) {
    return (data as { result_count: number }).result_count;
  }

  if ("records" in data && Array.isArray((data as { records?: unknown }).records)) {
    return (data as { records: unknown[] }).records.length;
  }

  if ("diagnoses" in data && Array.isArray((data as { diagnoses?: unknown }).diagnoses)) {
    return (data as { diagnoses: unknown[] }).diagnoses.length;
  }

  if ("items" in data && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: unknown[] }).items.length;
  }

  return undefined;
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && "tool" in value && "args" in value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "工具执行失败。";
}

export async function withToolTrace<T>(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<TracedToolExecution<T>> {
  const startedAt = Date.now();

  try {
    const data = await fn();
    const elapsed = Date.now() - startedAt;
    const resolvedTool = isToolResult(data) ? data.tool : toolName;
    const resolvedArgs = isToolResult(data) ? data.args : args;
    const resultPayload = isToolResult(data) ? data.data : data;
    const resultCount =
      isToolResult(data) && typeof data.result_count === "number"
        ? data.result_count
        : inferResultCount(resultPayload);

    return {
      data,
      trace: {
        tool: resolvedTool,
        args: resolvedArgs,
        status: "success",
        duration_ms: elapsed,
        result_count: resultCount,
      },
    };
  } catch (error: unknown) {
    return {
      error,
      trace: {
        tool: toolName,
        args,
        status: "failed",
        duration_ms: Date.now() - startedAt,
        error_message: getErrorMessage(error),
      },
    };
  }
}
