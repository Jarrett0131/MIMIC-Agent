import type {
  AppError,
  AskResponse,
  ErrorSource,
  ToolTraceItem,
  WorkflowStage,
} from "../../types";

const DEFAULT_ERROR_MESSAGE = "The agent could not complete the request.";
const DEFAULT_LIMITATION =
  "The current demo supports patient info, diagnoses, lab results, vital signs, and term or field explanations.";

type ErrorResponseOverrides = Partial<
  Pick<
    AskResponse,
    "question_type" | "workflow_state" | "tool_trace" | "answer" | "limitation"
  >
>;

export class AgentError extends Error {
  public readonly code: string;
  public readonly source: ErrorSource;
  public readonly detail?: unknown;
  public readonly status?: number;

  constructor(
    code: string,
    message: string,
    source: ErrorSource,
    detail?: unknown,
    status?: number,
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.source = source;
    this.detail = detail;
    this.status = status;
  }
}

function appendErrorStage(workflowState?: WorkflowStage[]): WorkflowStage[] {
  const state: WorkflowStage[] =
    workflowState && workflowState.length > 0 ? [...workflowState] : ["error"];
  if (state[state.length - 1] !== "error") {
    state.push("error");
  }
  return state;
}

function normalizeError(err: unknown): AppError {
  if (err instanceof AgentError) {
    return {
      code: err.code,
      message: err.message,
      source: err.source,
      detail: err.detail,
    };
  }

  if (err instanceof Error) {
    return {
      code: "UNEXPECTED_SERVER_ERROR",
      message: err.message || DEFAULT_ERROR_MESSAGE,
      source: "server",
    };
  }

  return {
    code: "UNEXPECTED_SERVER_ERROR",
    message: DEFAULT_ERROR_MESSAGE,
    source: "server",
  };
}

export function buildErrorResponse(
  err: unknown,
  overrides: ErrorResponseOverrides = {},
): AskResponse {
  const appError = normalizeError(err);
  const limitation =
    overrides.limitation ??
    (appError.source === "python-service"
      ? [
          "The data-service is unavailable. Confirm the Python service is running first.",
          DEFAULT_LIMITATION,
        ]
      : [DEFAULT_LIMITATION]);
  const answer =
    overrides.answer ??
    (appError.code === "UNSUPPORTED_QUESTION"
      ? "This demo does not support that question yet. Try patient info, diagnoses, labs, vitals, or explanation questions."
      : "The request could not be completed. Check the error details and service status.");

  return {
    success: false,
    question_type: overrides.question_type ?? null,
    workflow_state: appendErrorStage(overrides.workflow_state),
    answer,
    evidence: [],
    tool_trace: overrides.tool_trace ?? ([] as ToolTraceItem[]),
    limitation,
    error: appError,
  };
}

export function getHttpStatus(err: unknown): number {
  if (err instanceof AgentError && typeof err.status === "number") {
    return err.status;
  }
  return 500;
}
