import { enhanceAnswer } from "../agent/enhancement/answerEnhancement";
import { rewriteQuery } from "../agent/enhancement/queryRewrite";
import type {
  AnswerEnhancementResult,
  QueryRewriteResult,
} from "../agent/enhancement/types";
import { withToolTrace } from "../agent/withToolTrace";
import {
  AgentError,
  buildErrorResponse,
  getHttpStatus,
} from "../core/errors/AgentError";
import { writeStructuredLog } from "../logging/logger";
import { getRequestContext } from "../logging/requestContext";
import type {
  AgentResponse,
  AskEnhancementMeta,
  AskPipelineDiagnostics,
  AskRequest,
  ConversationTurn,
  AskResponse,
  ConversationContext,
  KnowledgeQuestionType,
  QuestionType,
  SuggestionItem,
  ToolTraceItem,
  WorkflowStage,
} from "../types";
import { isRecord, readString, readNumber } from "../utils/common";
import { classifyQuestion, type ClassificationResult } from "./classifier";
import { generateAnswer } from "./generator";
import { getLlmAvailability } from "./llmClient";
import { routeQuestion } from "./router";

const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  patient_info: "patient info",
  diagnosis_query: "diagnosis info",
  lab_query: "lab results",
  vital_query: "vital signs",
};

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

const KNOWN_RAG_CATEGORIES = new Set(["metric", "field", "term", "diagnosis", "knowledge"]);
const KNOWN_RAG_DOMAINS = new Set(["lab", "vital", "patient", "diagnosis", "general"]);

type RagToolData = {
  enabled?: unknown;
  retriever?: unknown;
  reason?: unknown;
  items?: unknown;
  experiment?: unknown;
};

export type ParsedAskRequest = AskRequest & {
  context: ConversationContext;
  stream: boolean;
};

export type AskPipelineResult =
  | {
      ok: true;
      response: AskResponse;
      answerChunks: string[];
      diagnostics: AskPipelineDiagnostics;
      streamedAnswer: boolean;
    }
  | {
      ok: false;
      status: number;
      response: AskResponse;
      diagnostics: AskPipelineDiagnostics;
    };

type AskPipelineHooks = {
  onWorkflow?: (workflowState: WorkflowStage[]) => Promise<void> | void;
  onAnswerDelta?: (delta: string, answer: string) => Promise<void> | void;
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

function isKnownRagCategory(
  value: string | undefined,
): value is "metric" | "field" | "term" | "diagnosis" | "knowledge" {
  return value !== undefined && KNOWN_RAG_CATEGORIES.has(value);
}

function isKnownRagDomain(
  value: string | undefined,
): value is "lab" | "vital" | "patient" | "diagnosis" | "general" {
  return value !== undefined && KNOWN_RAG_DOMAINS.has(value);
}

function buildDefaultDiagnostics(question: string): AskPipelineDiagnostics {
  return {
    original_question: question,
    resolved_question: question,
    rewrite: {
      enabled: false,
      original_question: question,
      rewritten_question: question,
      changed: false,
      source: "none",
      reason: "not_started",
      guard_applied: false,
      guard_reason: "not_started",
    },
    rag: {
      enabled: false,
      used: false,
      matched: false,
      knowledge_types: [],
      top_results: [],
    },
    success: false,
  };
}

function buildLlmDiagnostics(): AskPipelineDiagnostics["llm"] {
  const availability = getLlmAvailability();
  const llmCalls = getRequestContext()?.llmCalls ?? [];

  return {
    enabled: availability.enabled,
    available: availability.enabled,
    primary_provider: availability.provider,
    primary_model: availability.model,
    fallback_providers: availability.fallback_providers,
    budget_limit_tokens: availability.budget_limit_tokens,
    budget_exceeded: llmCalls.some((call) => call.status === "budget_rejected"),
    call_count: llmCalls.length,
    streamed: llmCalls.some((call) => call.streamed),
    fallback_used: llmCalls.some((call) => call.fallback_used),
    total_prompt_tokens: llmCalls.reduce(
      (total, call) => total + call.usage.prompt_tokens,
      0,
    ),
    total_completion_tokens: llmCalls.reduce(
      (total, call) => total + call.usage.completion_tokens,
      0,
    ),
    total_tokens: llmCalls.reduce((total, call) => total + call.usage.total_tokens, 0),
    estimated_usage: llmCalls.some((call) => call.usage.estimated),
    calls: llmCalls.map((call) => ({
      operation: call.operation,
      provider: call.provider,
      model: call.model,
      attempts: call.attempts,
      streamed: call.streamed,
      fallback_used: call.fallback_used,
      duration_ms: call.duration_ms,
      output_chars: call.output_chars,
      status: call.status,
      usage: call.usage,
      error_code: call.error_code,
      error_message: call.error_message,
    })),
  };
}

export function wantsStreamResponse(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }

  return (body as Record<string, unknown>).stream === true;
}

function parseConversationContext(value: unknown): ConversationContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      hadm_id: null,
      subject_id: null,
      patient_info: null,
      last_question_type: null,
    };
  }

  const context = value as Record<string, unknown>;

  return {
    hadm_id: isValidHadmId(context.hadm_id) ? context.hadm_id : null,
    subject_id: typeof context.subject_id === "number" && Number.isFinite(context.subject_id) && context.subject_id > 0 ? context.subject_id : null,
    patient_info: isRecord(context.patient_info) ? context.patient_info : null,
    last_question_type: isQuestionType(context.last_question_type)
      ? context.last_question_type
      : null,
    chat_history: parseConversationTurns(context.chat_history),
  };
}

function isConversationTurnStatus(
  value: unknown,
): value is ConversationTurn["status"] {
  return (
    value === "streaming" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function parseConversationTurnResponse(
  value: unknown,
): ConversationTurn["response"] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    success: value.success === true,
    question_type: isQuestionType(value.question_type) ? value.question_type : null,
    answer: typeof value.answer === "string" ? value.answer.trim() : "",
  };
}

function parseConversationTurns(value: unknown): ConversationTurn[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedTurns = value
    .map((item, index): ConversationTurn | null => {
      if (!isRecord(item)) {
        return null;
      }

      const question = typeof item.question === "string" ? item.question.trim() : "";
      if (!question) {
        return null;
      }

      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? item.id.trim()
            : `turn-${index + 1}`,
        question,
        response: parseConversationTurnResponse(item.response),
        status: isConversationTurnStatus(item.status) ? item.status : "completed",
        error: typeof item.error === "string" ? item.error.trim() : "",
      };
    })
    .filter((item): item is ConversationTurn => item !== null);

  if (normalizedTurns.length === 0) {
    return undefined;
  }

  return normalizedTurns.slice(-6);
}

export function parseAskRequest(body: unknown): ParsedAskRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const requestBody = body as Record<string, unknown>;
  const context = parseConversationContext(requestBody.context);
  const hadmId = isValidHadmId(requestBody.hadm_id) ? requestBody.hadm_id : context.hadm_id;
  const question = typeof requestBody.question === "string" ? requestBody.question.trim() : "";

  if (!hadmId || !question) {
    return null;
  }

  return {
    hadm_id: hadmId,
    question,
    stream: requestBody.stream === true,
    context: {
      hadm_id: hadmId,
      subject_id: context.subject_id,
      patient_info: context.patient_info,
      last_question_type: context.last_question_type,
      chat_history: context.chat_history,
    },
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

function buildSuggestions(questionType: QuestionType | null): SuggestionItem[] {
  if (!questionType) {
    return DEFAULT_SUGGESTIONS;
  }

  return SUGGESTION_MAP[questionType] ?? DEFAULT_SUGGESTIONS;
}

function isContextualFollowUp(question: string): boolean {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    return false;
  }

  return [
    /^(\u90a3\u4e2a|\u90a3\u4e48|\u8fd9\u4e2a|\u8fd9\u4f4d\u60a3\u8005|\u8fd9\u4e2a\u60a3\u8005|\u8fd9\u4e2a\u6307\u6807|\u7136\u540e|\u7ee7\u7eed)/i,
    /^(\u518d\u8be6\u7ec6\u4e00\u70b9|\u5c55\u5f00\u8bf4\u8bf4|\u8865\u5145\u4e00\u4e0b)/i,
    /^(what about that|and then|more details)/i,
    /(\u5417\??|\u5982\u4f55\??|\u600e\u4e48\u6837\??)$/i,
  ].some((pattern) => pattern.test(normalizedQuestion));
}

function resolveClassification(
  question: string,
  context: ConversationContext,
): {
  classification: ClassificationResult;
  normalizedQuestion: string;
} {
  try {
    return {
      classification: classifyQuestion(question),
      normalizedQuestion: question,
    };
  } catch (error: unknown) {
    if (context.last_question_type && isContextualFollowUp(question)) {
      const questionType = context.last_question_type;
      return {
        classification: {
          routeType: questionType,
          displayType: questionType,
          routeFamily: "structured",
        },
        normalizedQuestion: `${QUESTION_TYPE_HINTS[questionType]}: ${question}`,
      };
    }

    return {
      classification: {
        routeType: "knowledge_query",
        displayType: "patient_info",
        routeFamily: "rag",
      },
      normalizedQuestion: question,
    };
  }
}

function buildEnhancementMeta(args: {
  queryRewrite?: QueryRewriteResult;
  answerEnhancement?: AnswerEnhancementResult;
}): AskEnhancementMeta | undefined {
  const meta: AskEnhancementMeta = {};

  if (args.queryRewrite) {
    meta.query_rewrite = {
      enabled: args.queryRewrite.enabled,
      changed: args.queryRewrite.changed,
      original_question: args.queryRewrite.original_question,
      rewritten_question: args.queryRewrite.rewritten_question,
      source: args.queryRewrite.source,
      confidence: args.queryRewrite.confidence,
      reason: args.queryRewrite.reason,
      guard_applied: args.queryRewrite.guard_applied,
      guard_reason: args.queryRewrite.guard_reason,
    };
  }

  if (args.answerEnhancement) {
    meta.answer_enhancement = {
      enabled: args.answerEnhancement.enabled,
      called: args.answerEnhancement.called,
      changed: args.answerEnhancement.changed,
      applied: args.answerEnhancement.applied,
      fallback: args.answerEnhancement.fallback,
      fallback_reason: args.answerEnhancement.fallback_reason,
      reason: args.answerEnhancement.reason,
    };
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

function buildRagDiagnostics(
  routeType: KnowledgeQuestionType,
  toolData: unknown,
): AskPipelineDiagnostics["rag"] {
  const payload =
    isRecord(toolData) && "data" in toolData && isRecord(toolData.data)
      ? toolData.data
      : toolData;

  if (!isRecord(payload)) {
    return {
      enabled: false,
      used: true,
      route_type: routeType,
      matched: false,
      reason: "invalid_rag_payload",
      knowledge_types: [],
      top_results: [],
    };
  }

  const ragData = payload as RagToolData;
  const rawItems = Array.isArray(ragData.items) ? ragData.items : [];
  const topResults = rawItems
    .filter(isRecord)
    .map((item) => {
      const category = readString(item.category);
      const domain = readString(item.domain);
      const matchedTerms = Array.isArray(item.matched_terms)
        ? item.matched_terms.filter((value): value is string => typeof value === "string")
        : [];

      if (!isKnownRagCategory(category)) {
        return null;
      }

      if (!isKnownRagDomain(domain)) {
        return null;
      }

      return {
        title: readString(item.title) ?? "unknown",
        source: readString(item.source) ?? "docs/rag",
        score: readNumber(item.score) ?? 0,
        category,
        domain,
        matched_terms: matchedTerms,
        lexical_score: readNumber(item.lexical_score),
        embedding_similarity: readNumber(item.embedding_similarity),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const experiment =
    isRecord(ragData.experiment)
      ? {
          enabled: ragData.experiment.enabled === true,
          applied: ragData.experiment.applied === true,
          strategy: readString(ragData.experiment.strategy),
          provider: readString(ragData.experiment.provider),
          model: readString(ragData.experiment.model),
          cache_path: readString(ragData.experiment.cache_path),
          candidate_count: readNumber(ragData.experiment.candidate_count) ?? 0,
          rescored_count: readNumber(ragData.experiment.rescored_count) ?? 0,
          reason: readString(ragData.experiment.reason),
        }
      : undefined;

  return {
    enabled: ragData.enabled !== false,
    used: true,
    route_type: routeType,
    retriever: readString(ragData.retriever),
    matched: topResults.length > 0,
    reason: readString(ragData.reason),
    knowledge_types: [...new Set(topResults.map((item) => item.category))],
    top_results: topResults,
    experiment,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unknown error";
}

function extractToolPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  if ("data" in value && isRecord(value.data)) {
    return value.data;
  }

  return value;
}

export async function runAskPipeline(
  payload: ParsedAskRequest,
  hooks: AskPipelineHooks = {},
): Promise<AskPipelineResult> {
  const workflowState: WorkflowStage[] = [];
  const toolTrace: ToolTraceItem[] = [];
  const diagnostics = buildDefaultDiagnostics(payload.question);
  let displayQuestionType: QuestionType | null = null;
  let responseContext: ConversationContext = payload.context;
  let classification: ClassificationResult | null = null;
  let rewriteResult: QueryRewriteResult | undefined;
  let answerEnhancementResult: AnswerEnhancementResult | undefined;

  try {
    // Log request start
    writeStructuredLog("request.start", {
      original_question: payload.question,
      hadm_id: payload.hadm_id,
      context: {
        hadm_id: payload.context.hadm_id,
        subject_id: payload.context.subject_id,
        has_patient_info: !!payload.context.patient_info,
        last_question_type: payload.context.last_question_type,
      },
    });

    workflowState.push("classifying");
    await hooks.onWorkflow?.([...workflowState]);

    rewriteResult = await rewriteQuery({
      question: payload.question,
      hadm_id: payload.hadm_id,
      last_question_type: payload.context.last_question_type,
      chat_history: payload.context.chat_history,
    });
    diagnostics.rewrite = {
      enabled: rewriteResult.enabled,
      original_question: rewriteResult.original_question,
      rewritten_question: rewriteResult.rewritten_question,
      changed: rewriteResult.changed,
      source: rewriteResult.source,
      confidence: rewriteResult.confidence,
      reason: rewriteResult.reason,
      guard_applied: rewriteResult.guard_applied,
      guard_reason: rewriteResult.guard_reason,
    };

    const resolvedQuestion = resolveClassification(
      rewriteResult.rewritten_question,
      payload.context,
    );
    diagnostics.resolved_question = resolvedQuestion.normalizedQuestion;
    classification = resolvedQuestion.classification;
    diagnostics.classification = {
      route_type: classification.routeType,
      display_type: classification.displayType,
      route_family: classification.routeFamily,
    };
    displayQuestionType = classification.displayType;
    responseContext = {
      hadm_id: payload.hadm_id,
      subject_id: payload.context.subject_id,
      patient_info: payload.context.patient_info,
      last_question_type: classification.displayType,
    };

    // Log classification result
    writeStructuredLog("request.classification", {
      original_question: rewriteResult.original_question,
      rewritten_question: rewriteResult.rewritten_question,
      intent: classification.routeType,
      display_type: classification.displayType,
      route_family: classification.routeFamily,
      has_context: !!payload.context.subject_id,
    });

    workflowState.push("tool_running");
    await hooks.onWorkflow?.([...workflowState]);

    // Get primary tool based on classification
    const routedTool = routeQuestion(
      {
        hadm_id: payload.hadm_id,
        question: resolvedQuestion.normalizedQuestion,
      },
      classification.routeType,
    );
    diagnostics.routed_tool = routedTool.tool;

    // Execute primary tool
    const tracedTool = await withToolTrace(
      routedTool.tool,
      routedTool.args,
      routedTool.execute,
    );
    toolTrace.push(tracedTool.trace);

    const primaryToolData = extractToolPayload(tracedTool.data);

    if (tracedTool.error) {
      writeStructuredLog("tool.execution.failed", {
        tool: routedTool.tool,
        error: getErrorMessage(tracedTool.error),
        question: resolvedQuestion.normalizedQuestion,
      });

      throw tracedTool.error;
    }

    // Log tool execution result
    writeStructuredLog("request.tool_execution", {
      tool: routedTool.tool,
      status: "success",
      has_data: primaryToolData !== null,
      is_fallback: false,
    });

    let toolData = primaryToolData;

    // Optionally use RAG as enhancement for non-rag routes
    if (classification.routeFamily !== "rag") {
      try {
        // Run RAG tool as enhancement
        const ragTool = routeQuestion(
          {
            hadm_id: payload.hadm_id,
            question: resolvedQuestion.normalizedQuestion,
          },
          "knowledge_query",
        );
        
        const tracedRagTool = await withToolTrace(
          ragTool.tool,
          ragTool.args,
          ragTool.execute,
        );
        toolTrace.push(tracedRagTool.trace);

        const ragToolData = extractToolPayload(tracedRagTool.data);

        if (!tracedRagTool.error && toolData && ragToolData) {
          toolData = {
            ...toolData,
            rag_enhancement: ragToolData,
          };

          diagnostics.rag = buildRagDiagnostics(
            "knowledge_query",
            ragToolData,
          );
        }
      } catch (ragError) {
        writeStructuredLog("rag.enhancement.failed", {
          error: getErrorMessage(ragError),
          question: resolvedQuestion.normalizedQuestion,
        });
      }
    } else {
      // For rag routes, use the rag data directly
      diagnostics.rag = buildRagDiagnostics(
        classification.routeType as KnowledgeQuestionType,
        primaryToolData ?? tracedTool.data,
      );
    }

    if (!toolData) {
      throw new AgentError(
        "EMPTY_TOOL_RESULT",
        "Tool execution completed without returning data.",
        "router",
        {
          question_type: classification.routeType,
        },
        500,
      );
    }

    await hooks.onWorkflow?.([...workflowState, "answering"]);

    const generatedAnswer = await generateAnswer(
      classification.routeType,
      classification.displayType,
      toolData,
      workflowState,
      toolTrace,
      resolvedQuestion.normalizedQuestion,
      payload.context?.patient_info as Record<string, unknown> | undefined,
      hooks.onAnswerDelta
        ? {
            onAnswerDelta: hooks.onAnswerDelta,
          }
        : undefined,
    );

    answerEnhancementResult = generatedAnswer.streamed
      ? {
          enabled: true,
          called: false,
          original_answer: generatedAnswer.response.answer,
          enhanced_answer: generatedAnswer.response.answer,
          changed: false,
          applied: false,
          fallback: true,
          fallback_reason: "skipped_for_native_streaming",
          reason: "skipped_for_native_streaming",
          answer_links: generatedAnswer.response.answer_links ?? [],
        }
      : await enhanceAnswer({
          question: resolvedQuestion.normalizedQuestion,
          question_type: classification.routeType,
          answer: generatedAnswer.response.answer,
          evidence: generatedAnswer.response.evidence,
          tool_trace: toolTrace,
          answer_links: generatedAnswer.response.answer_links ?? [],
          limitation: generatedAnswer.response.limitation,
        });
    diagnostics.answer_enhancement = {
      enabled: answerEnhancementResult.enabled,
      called: answerEnhancementResult.called,
      changed: answerEnhancementResult.changed,
      applied: answerEnhancementResult.applied,
      fallback: answerEnhancementResult.fallback,
      fallback_reason: answerEnhancementResult.fallback_reason,
      reason: answerEnhancementResult.reason,
    };

    const response = generatedAnswer.response;
    const answerChunks =
      answerEnhancementResult.applied && answerEnhancementResult.enhanced_answer
        ? [answerEnhancementResult.enhanced_answer]
        : generatedAnswer.answerChunks;

    if (answerEnhancementResult.applied) {
      response.answer = answerEnhancementResult.enhanced_answer;
      response.answer_links = answerEnhancementResult.answer_links;
    }

    response.context = responseContext;
    response.suggestions = buildSuggestions(displayQuestionType);
    response.enhancement = buildEnhancementMeta({
      queryRewrite: rewriteResult,
      answerEnhancement: answerEnhancementResult,
    });

    // Build AgentResponse structure
    const agentResponse: AgentResponse = {
      answer: response.answer,
      evidence: response.evidence.map(item => ({
        type: item.type,
        content: item.content,
      })),
      tool_trace: response.tool_trace.map(trace => ({
        tool: trace.tool,
        status: trace.status === "success" ? "success" : "error",
        input: trace.args,
        output_summary: trace.status === "success" ? `Successfully retrieved ${trace.result_count || 0} results` : trace.error_message || "Error occurred",
      })),
    };

    // Add missing info if any
    const missingInfo: string[] = [];
    if (!payload.hadm_id) {
      missingInfo.push("hadm_id");
    }
    if (!payload.context?.subject_id) {
      missingInfo.push("subject_id");
    }
    if (missingInfo.length > 0) {
      agentResponse.missing_info = missingInfo;
    }

    // Add agentResponse to the response object
    (response as any).agent_response = agentResponse;
    diagnostics.llm = buildLlmDiagnostics();
    response.diagnostics = diagnostics;

    // Log request completion
    writeStructuredLog("request.complete", {
      success: true,
      original_question: payload.question,
      rewritten_question: rewriteResult?.rewritten_question,
      intent: classification?.routeType,
      tools_called: toolTrace.map(t => t.tool),
      answer_length: response.answer.length,
      evidence_count: response.evidence.length,
      missing_info: missingInfo,
    });

    diagnostics.success = true;

    return {
      ok: true,
      response,
      answerChunks,
      diagnostics,
      streamedAnswer: generatedAnswer.streamed,
    };
  } catch (error: unknown) {
    // Log request failure
    writeStructuredLog("request.failed", {
      success: false,
      original_question: payload.question,
      rewritten_question: rewriteResult?.rewritten_question,
      intent: classification?.routeType,
      tools_called: toolTrace.map(t => t.tool),
      error: error instanceof Error ? error.message : "Unknown error",
      error_code: error instanceof AgentError ? error.code : "UNKNOWN_ERROR",
    });

    const errorResponse = buildErrorResponse(error, {
      question_type: displayQuestionType,
      workflow_state: workflowState,
      tool_trace: toolTrace,
    });
    errorResponse.context = responseContext;
    errorResponse.suggestions = buildSuggestions(
      displayQuestionType ?? payload.context.last_question_type,
    );

    if (classification) {
      errorResponse.routing = {
        route_type: classification.routeType,
        route_family: classification.routeFamily,
      };
    }

    errorResponse.enhancement = buildEnhancementMeta({
      queryRewrite: rewriteResult,
      answerEnhancement: answerEnhancementResult,
    });

    diagnostics.success = false;
    diagnostics.error_code = errorResponse.error?.code ?? undefined;
    diagnostics.llm = buildLlmDiagnostics();
    errorResponse.diagnostics = diagnostics;

    return {
      ok: false,
      status: getHttpStatus(error),
      response: errorResponse,
      diagnostics,
    };
  }
}
