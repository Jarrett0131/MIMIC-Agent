import { AgentError, buildErrorResponse, getHttpStatus } from "../errors";
import { writeStructuredLog } from "../logging";
import { mimicAgent } from "../mastra";
import type {
  AskPipelineDiagnostics,
  AskRequest,
  AskResponse,
  ConversationContext,
  ConversationTurn,
  EvidenceItem,
  QuestionType,
  SuggestionItem,
  ToolTraceItem,
  WorkflowStage,
} from "../types";
import { isRecord } from "../utils";

const STRUCTURED_LIMITATION = "以下回答基于患者的结构化医疗数据。";
const RAG_LIMITATION = "以下解释基于本地医学知识库。";
const LLM_GENERAL_LIMITATION =
  "以下回答由语言模型直接生成，未调用本地患者数据，仅供参考，不能替代专业医疗建议。";

const DEFAULT_SUGGESTIONS: SuggestionItem[] = [
  {
    id: "patient-overview",
    label: "Patient overview",
    question: "What are this patient's demographics and admission details?",
  },
  {
    id: "recent-glucose",
    label: "Latest glucose",
    question: "What is the latest glucose result for this patient?",
  },
  {
    id: "recent-heart-rate",
    label: "Latest heart rate",
    question: "What is the latest heart rate for this patient?",
  },
  {
    id: "diagnosis-list",
    label: "Diagnoses",
    question: "What diagnoses are recorded for this patient?",
  },
];

const SUGGESTION_MAP: Record<QuestionType, SuggestionItem[]> = {
  patient_info: [
    {
      id: "patient-to-diagnosis",
      label: "Diagnoses",
      question: "What diagnoses are recorded for this patient?",
    },
    {
      id: "patient-to-glucose",
      label: "Latest glucose",
      question: "What is the latest glucose result for this patient?",
    },
    {
      id: "patient-to-heart-rate",
      label: "Latest heart rate",
      question: "What is the latest heart rate for this patient?",
    },
  ],
  diagnosis_query: [
    {
      id: "diagnosis-to-patient",
      label: "Patient overview",
      question: "What are this patient's demographics and admission details?",
    },
    {
      id: "diagnosis-to-glucose",
      label: "Latest glucose",
      question: "What is the latest glucose result for this patient?",
    },
    {
      id: "diagnosis-to-heart-rate",
      label: "Latest heart rate",
      question: "What is the latest heart rate for this patient?",
    },
  ],
  lab_query: [
    {
      id: "lab-to-patient",
      label: "Patient overview",
      question: "What are this patient's demographics and admission details?",
    },
    {
      id: "lab-to-diagnosis",
      label: "Diagnoses",
      question: "What diagnoses are recorded for this patient?",
    },
    {
      id: "lab-to-vital",
      label: "Latest heart rate",
      question: "What is the latest heart rate for this patient?",
    },
  ],
  vital_query: [
    {
      id: "vital-to-patient",
      label: "Patient overview",
      question: "What are this patient's demographics and admission details?",
    },
    {
      id: "vital-to-diagnosis",
      label: "Diagnoses",
      question: "What diagnoses are recorded for this patient?",
    },
    {
      id: "vital-to-lab",
      label: "Latest glucose",
      question: "What is the latest glucose result for this patient?",
    },
  ],
};

/** Maps a Mastra tool name to the display question type used by the frontend. */
const TOOL_DISPLAY_TYPE: Record<string, QuestionType> = {
  getPatient: "patient_info",
  getDiagnoses: "diagnosis_query",
  getLabs: "lab_query",
  getVitals: "vital_query",
  retrieveKnowledge: "patient_info",
};

export type ParsedAskRequest = AskRequest & {
  context: ConversationContext;
  stream: boolean;
};

export type MastraAskHooks = {
  onWorkflow?: (workflowState: WorkflowStage[]) => Promise<void> | void;
  onAnswerDelta?: (delta: string, answer: string) => Promise<void> | void;
};

export type MastraAskResult =
  | {
      ok: true;
      response: AskResponse;
      diagnostics: AskPipelineDiagnostics;
    }
  | {
      ok: false;
      status: number;
      response: AskResponse;
      diagnostics: AskPipelineDiagnostics;
    };

function isValidHadmId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isQuestionType(value: unknown): value is QuestionType {
  return (
    value === "patient_info" ||
    value === "lab_query" ||
    value === "vital_query" ||
    value === "diagnosis_query"
  );
}

export function wantsStreamResponse(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }

  return (body as Record<string, unknown>).stream === true;
}

function parseConversationTurns(value: unknown): ConversationTurn[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const turns = value
    .map((item, index): ConversationTurn | null => {
      if (!isRecord(item)) {
        return null;
      }

      const question = typeof item.question === "string" ? item.question.trim() : "";
      if (!question) {
        return null;
      }

      const response = isRecord(item.response)
        ? {
            success: item.response.success === true,
            question_type: isQuestionType(item.response.question_type)
              ? item.response.question_type
              : null,
            answer:
              typeof item.response.answer === "string"
                ? item.response.answer.trim()
                : "",
          }
        : null;

      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `turn-${index + 1}`,
        question,
        response,
        status: "completed",
        error: typeof item.error === "string" ? item.error.trim() : "",
      };
    })
    .filter((item): item is ConversationTurn => item !== null);

  return turns.length > 0 ? turns.slice(-6) : undefined;
}

function parseConversationContext(value: unknown): ConversationContext {
  if (!isRecord(value)) {
    return {
      hadm_id: null,
      subject_id: null,
      patient_info: null,
      last_question_type: null,
    };
  }

  return {
    hadm_id: isValidHadmId(value.hadm_id) ? value.hadm_id : null,
    subject_id:
      typeof value.subject_id === "number" &&
      Number.isFinite(value.subject_id) &&
      value.subject_id > 0
        ? value.subject_id
        : null,
    patient_info: isRecord(value.patient_info) ? value.patient_info : null,
    last_question_type: isQuestionType(value.last_question_type)
      ? value.last_question_type
      : null,
    chat_history: parseConversationTurns(value.chat_history),
  };
}

export function parseAskRequest(body: unknown): ParsedAskRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const requestBody = body as Record<string, unknown>;
  const context = parseConversationContext(requestBody.context);
  const hadmId = isValidHadmId(requestBody.hadm_id) ? requestBody.hadm_id : context.hadm_id;
  const question =
    typeof requestBody.question === "string" ? requestBody.question.trim() : "";

  if (!hadmId || !question) {
    return null;
  }

  return {
    hadm_id: hadmId,
    question,
    stream: requestBody.stream === true,
    context: { ...context, hadm_id: hadmId },
  };
}

export function buildInvalidRequestResponse(body: unknown): AskResponse {
  return buildErrorResponse(
    new AgentError("INVALID_REQUEST", "Invalid request payload.", "server", { body }, 400),
    {
      workflow_state: ["error"],
      limitation: ["The request body must include a valid hadm_id and question."],
      answer: "The request parameters are invalid. Please check the payload and try again.",
    },
  );
}

export function buildDefaultDiagnostics(question: string): AskPipelineDiagnostics {
  return {
    original_question: question,
    resolved_question: question,
    rewrite: {
      enabled: false,
      original_question: question,
      rewritten_question: question,
      changed: false,
      source: "none",
      reason: "mastra_agent",
    },
    rag: {
      enabled: true,
      used: false,
      matched: false,
      knowledge_types: [],
      top_results: [],
    },
    success: false,
  };
}

type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

function buildAgentMessages(payload: ParsedAskRequest): AgentMessage[] {
  const messages: AgentMessage[] = [];

  for (const turn of payload.context.chat_history ?? []) {
    messages.push({ role: "user", content: turn.question });
    if (turn.response?.answer) {
      messages.push({ role: "assistant", content: turn.response.answer });
    }
  }

  messages.push({
    role: "user",
    content: `当前患者 hadm_id: ${payload.hadm_id}。\n用户问题：${payload.question}`,
  });

  return messages;
}

function inferResultCount(toolName: string, result: unknown): number | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  if (toolName === "getPatient") {
    return isRecord(result.patient_overview) &&
      Object.keys(result.patient_overview).length > 0
      ? 1
      : 0;
  }

  if (toolName === "getDiagnoses" && Array.isArray(result.diagnoses)) {
    return result.diagnoses.length;
  }

  if (Array.isArray(result.records)) {
    return result.records.length;
  }

  if (Array.isArray(result.items)) {
    return result.items.length;
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildEvidenceForTool(toolName: string, result: unknown): EvidenceItem[] {
  if (!isRecord(result)) {
    return [];
  }

  if (toolName === "getPatient") {
    const overview = isRecord(result.patient_overview) ? result.patient_overview : null;
    if (!overview || Object.keys(overview).length === 0) {
      return [];
    }
    return [{ type: "patient", title: "Patient overview", content: overview }];
  }

  if (toolName === "getDiagnoses" && Array.isArray(result.diagnoses)) {
    return result.diagnoses.filter(isRecord).map((diagnosis, index) => ({
      type: "diagnosis" as const,
      title: `Diagnosis ${index + 1}`,
      content: diagnosis,
    }));
  }

  if ((toolName === "getLabs" || toolName === "getVitals") && Array.isArray(result.records)) {
    const evidenceType = toolName === "getLabs" ? ("lab" as const) : ("vital" as const);
    return result.records.filter(isRecord).map((record, index) => ({
      type: evidenceType,
      title: readString(record.label) ?? `Record ${index + 1}`,
      content: record,
    }));
  }

  if (toolName === "retrieveKnowledge" && Array.isArray(result.items)) {
    return result.items.filter(isRecord).map((item, index) => ({
      type: "text" as const,
      title: readString(item.title) ?? `Knowledge item ${index + 1}`,
      content: {
        source: readString(item.source) ?? "docs/rag",
        title: readString(item.title) ?? `Knowledge item ${index + 1}`,
        chunk: readString(item.chunk) ?? "",
        score: typeof item.score === "number" ? item.score : null,
        category: readString(item.category),
        domain: readString(item.domain),
      },
    }));
  }

  return [];
}

function buildLimitations(toolsUsed: string[]): string[] {
  const limitations: string[] = [];
  const usedStructured = toolsUsed.some((tool) => tool !== "retrieveKnowledge");
  const usedRag = toolsUsed.includes("retrieveKnowledge");

  if (usedStructured) {
    limitations.push(STRUCTURED_LIMITATION);
  }
  if (usedRag) {
    limitations.push(RAG_LIMITATION);
  }
  if (limitations.length === 0) {
    limitations.push(LLM_GENERAL_LIMITATION);
  }

  return limitations;
}

function buildSuggestions(questionType: QuestionType | null): SuggestionItem[] {
  if (!questionType) {
    return DEFAULT_SUGGESTIONS;
  }

  return SUGGESTION_MAP[questionType] ?? DEFAULT_SUGGESTIONS;
}

/**
 * Runs the /ask request through the Mastra mimic agent.
 *
 * The LLM decides which tool(s) to call (replacing the legacy regex
 * classifier + static router), while this adapter preserves the response
 * contract the frontend already understands: workflow stages, streamed
 * answer deltas, evidence items, tool trace, suggestions.
 */
export async function runMastraAsk(
  payload: ParsedAskRequest,
  hooks: MastraAskHooks = {},
): Promise<MastraAskResult> {
  const workflowState: WorkflowStage[] = [];
  const toolTrace: ToolTraceItem[] = [];
  const evidence: EvidenceItem[] = [];
  const toolsUsed: string[] = [];
  const toolStartTimes = new Map<string, number>();
  const diagnostics = buildDefaultDiagnostics(payload.question);
  let displayQuestionType: QuestionType | null = null;
  let answer = "";

  const pushStage = async (stage: WorkflowStage): Promise<void> => {
    if (workflowState[workflowState.length - 1] === stage) {
      return;
    }
    workflowState.push(stage);
    await hooks.onWorkflow?.([...workflowState]);
  };

  try {
    writeStructuredLog("request.start", {
      original_question: payload.question,
      hadm_id: payload.hadm_id,
      engine: "mastra",
    });

    await pushStage("classifying");

    const stream = await mimicAgent.stream(buildAgentMessages(payload));

    for await (const chunk of stream.fullStream) {
      if (chunk.type === "tool-call") {
        const toolName = chunk.payload.toolName;
        toolStartTimes.set(chunk.payload.toolCallId, Date.now());
        toolsUsed.push(toolName);
        if (!displayQuestionType && TOOL_DISPLAY_TYPE[toolName]) {
          displayQuestionType = TOOL_DISPLAY_TYPE[toolName];
        }
        await pushStage("tool_running");
        writeStructuredLog("request.tool_call", {
          tool: toolName,
          args: chunk.payload.args,
        });
        continue;
      }

      if (chunk.type === "tool-result") {
        const toolName = chunk.payload.toolName;
        const startedAt = toolStartTimes.get(chunk.payload.toolCallId);
        const failed = chunk.payload.isError === true;
        toolTrace.push({
          tool: toolName,
          args: isRecord(chunk.payload.args) ? chunk.payload.args : {},
          status: failed ? "failed" : "success",
          duration_ms: startedAt ? Date.now() - startedAt : 0,
          result_count: failed
            ? undefined
            : inferResultCount(toolName, chunk.payload.result),
          error_message: failed ? String(chunk.payload.result ?? "Tool failed") : undefined,
        });
        if (!failed) {
          evidence.push(...buildEvidenceForTool(toolName, chunk.payload.result));
        }
        continue;
      }

      if (chunk.type === "text-delta") {
        const delta = chunk.payload.text;
        if (!delta) {
          continue;
        }
        if (!workflowState.includes("answering")) {
          await pushStage("answering");
        }
        answer += delta;
        await hooks.onAnswerDelta?.(delta, answer);
        continue;
      }

      if (chunk.type === "error") {
        const errorPayload = (chunk as { payload?: { error?: unknown } }).payload;
        throw errorPayload?.error instanceof Error
          ? errorPayload.error
          : new Error(String(errorPayload?.error ?? "Agent stream error"));
      }
    }

    if (!answer.trim()) {
      throw new Error("Agent completed without producing an answer.");
    }

    const routeFamily =
      toolsUsed.length > 0 && toolsUsed.every((tool) => tool === "retrieveKnowledge")
        ? ("rag" as const)
        : ("structured" as const);

    diagnostics.success = true;
    diagnostics.routed_tool = toolsUsed[0];
    if (toolsUsed.includes("retrieveKnowledge")) {
      diagnostics.rag = {
        enabled: true,
        used: true,
        route_type: "knowledge_query",
        matched: evidence.some((item) => item.type === "text"),
        knowledge_types: [],
        top_results: [],
      };
    }

    const response: AskResponse = {
      success: true,
      question_type: displayQuestionType,
      workflow_state: [...workflowState, "done"],
      answer,
      evidence,
      tool_trace: toolTrace,
      limitation: buildLimitations(toolsUsed),
      error: null,
      context: {
        hadm_id: payload.hadm_id,
        subject_id: payload.context.subject_id,
        patient_info: payload.context.patient_info,
        last_question_type: displayQuestionType,
      },
      suggestions: buildSuggestions(displayQuestionType),
      routing: {
        route_type:
          routeFamily === "rag" ? "knowledge_query" : displayQuestionType ?? "patient_info",
        route_family: routeFamily,
      },
      diagnostics,
    };

    writeStructuredLog("request.complete", {
      success: true,
      engine: "mastra",
      original_question: payload.question,
      tools_called: toolsUsed,
      answer_length: answer.length,
      evidence_count: evidence.length,
    });

    return { ok: true, response, diagnostics };
  } catch (error: unknown) {
    writeStructuredLog("request.failed", {
      success: false,
      engine: "mastra",
      original_question: payload.question,
      tools_called: toolsUsed,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    const errorResponse = buildErrorResponse(error, {
      question_type: displayQuestionType,
      workflow_state: [...workflowState, "error"],
      tool_trace: toolTrace,
    });
    errorResponse.context = {
      hadm_id: payload.hadm_id,
      subject_id: payload.context.subject_id,
      patient_info: payload.context.patient_info,
      last_question_type: displayQuestionType ?? payload.context.last_question_type,
    };
    errorResponse.suggestions = buildSuggestions(
      displayQuestionType ?? payload.context.last_question_type,
    );

    diagnostics.success = false;
    diagnostics.error_code = errorResponse.error?.code ?? undefined;

    return {
      ok: false,
      status: getHttpStatus(error),
      response: errorResponse,
      diagnostics,
    };
  }
}
