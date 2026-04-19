import { QUERY_REWRITE_ENABLED } from "../../config";
import { getLlmScenario } from "../../config/llmScenarios";
import { writeStructuredLog } from "../../logging/logger";
import type { ConversationTurn, StructuredQuestionType } from "../../types";
import { type ClassificationResult, classifyQuestion } from "../../services/classifier";
import {
  generateLlmJson,
  getLlmAvailability,
  LlmClientError,
} from "../../services/llmClient";
import type { QueryRewriteInput, QueryRewriteResult } from "./types";

type QueryRewritePayload = {
  rewritten_question?: string;
  changed?: boolean;
  confidence?: number;
  reason?: string;
};

type RewriteIntent = {
  rewrite: string;
  confidence: number;
  reason: string;
};

type RewriteGuardDecision = {
  allowed: boolean;
  reason: string;
};

const FOLLOW_UP_PREFIX_PATTERNS: RegExp[] = [
  /^(?:那|那么|那个|这个|这项|然后|继续|再)/u,
  /^(?:what about|how about|and |then )/i,
];

const FOLLOW_UP_SUFFIX_PATTERNS: RegExp[] = [/(?:呢|啊|吗|？|\?)$/u];

const AMBIGUOUS_FOLLOW_UP_PATTERNS: RegExp[] = [
  /指标/u,
  /字段/u,
  /最近一次/u,
  /latest one/i,
  /this metric/i,
  /this field/i,
];

const ENGLISH_CLEAR_PATTERNS: RegExp[] = [
  /^what about (glucose|blood pressure|heart rate|pulse|wbc|creatinine|hemoglobin)\??$/i,
  /^and what does .+ mean\??$/i,
  /^what does .+ mean\??$/i,
  /^what does .+ measure\??$/i,
];

const PATIENT_INFO_GUARD_PATTERNS: RegExp[] = [
  /\bpatient info\b/i,
  /\bpatient overview\b/i,
  /\bpatient demographics?\b/i,
  /\bbasic (?:info|information)\b/i,
  /\bdemographics?\b/i,
  /^\s*patient\??\s*$/i,
  /\band patient\b/i,
  /患者信息/u,
  /病人信息/u,
  /基本信息/u,
];

const SHORT_QUESTION_MAX_LENGTH = 20;
const LARGE_REWRITE_DISTANCE_RATIO = 0.58;
const MAX_CHAT_HISTORY_TURNS = 4;
const MAX_HISTORY_ANSWER_CHARS = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function isStructuredQuestionType(
  value: unknown,
): value is StructuredQuestionType {
  return (
    value === "patient_info" ||
    value === "lab_query" ||
    value === "vital_query" ||
    value === "diagnosis_query"
  );
}

function getRecentTurns(chatHistory: ConversationTurn[] | undefined): ConversationTurn[] {
  return Array.isArray(chatHistory) ? chatHistory.slice(-MAX_CHAT_HISTORY_TURNS) : [];
}

function hasUsableChatHistory(chatHistory: ConversationTurn[] | undefined): boolean {
  return getRecentTurns(chatHistory).some((turn) => {
    const question = normalizeText(turn.question);
    const answer = normalizeText(turn.response?.answer ?? "");
    return question.length > 0 || answer.length > 0;
  });
}

function buildHistorySummary(chatHistory: ConversationTurn[] | undefined): string | null {
  const turns = getRecentTurns(chatHistory)
    .map((turn, index) => {
      const normalizedQuestion = normalizeText(turn.question);
      if (!normalizedQuestion) {
        return null;
      }

      const parts = [`Turn ${index + 1} question: ${normalizedQuestion}`];
      if (turn.response) {
        if (turn.response.question_type) {
          parts.push(`type: ${turn.response.question_type}`);
        }

        const normalizedAnswer = normalizeText(turn.response.answer ?? "");
        if (normalizedAnswer) {
          parts.push(
            `answer: ${truncateText(normalizedAnswer, MAX_HISTORY_ANSWER_CHARS)}`,
          );
        }
      }

      return parts.join(" | ");
    })
    .filter((item): item is string => item !== null);

  return turns.length > 0 ? turns.join("\n") : null;
}

function getLatestHistorySignal(
  chatHistory: ConversationTurn[] | undefined,
): { text: string; questionType: StructuredQuestionType | null } | null {
  const turns = getRecentTurns(chatHistory);

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const combined = normalizeText(
      [turn.question, turn.response?.answer ?? ""].filter(Boolean).join(" "),
    );

    if (!combined) {
      continue;
    }

    return {
      text: combined,
      questionType:
        turn.response && isStructuredQuestionType(turn.response.question_type)
          ? turn.response.question_type
          : null,
    };
  }

  return null;
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function withGuardState(
  result: QueryRewriteResult,
  guardApplied: boolean,
  guardReason: string,
): QueryRewriteResult {
  return {
    ...result,
    guard_applied: guardApplied,
    guard_reason: guardReason,
  };
}

function buildUnchangedResult(
  input: QueryRewriteInput,
  reason: string,
  guardApplied = false,
  guardReason = reason,
): QueryRewriteResult {
  const originalQuestion = normalizeText(input.question);
  return {
    enabled: QUERY_REWRITE_ENABLED,
    original_question: originalQuestion,
    rewritten_question: originalQuestion,
    changed: false,
    source: "none",
    reason,
    guard_applied: guardApplied,
    guard_reason: guardReason,
  };
}

function logRewrite(result: QueryRewriteResult): QueryRewriteResult {
  writeStructuredLog("ask.rewrite", {
    "ask.rewrite.source": result.source,
    "ask.rewrite.changed": result.changed,
    "ask.rewrite.original": result.original_question,
    "ask.rewrite.rewritten": result.rewritten_question,
    "ask.rewrite.guard_applied": result.guard_applied === true,
    "ask.rewrite.guard_reason": result.guard_reason,
    ask_rewrite_source: result.source,
    ask_rewrite_changed: result.changed,
    ask_rewrite_original: result.original_question,
    ask_rewrite_rewritten: result.rewritten_question,
    rewrite_guard_applied: result.guard_applied === true,
    rewrite_guard_reason: result.guard_reason,
    enabled: result.enabled,
    source: result.source,
    original_question: result.original_question,
    rewritten_question: result.rewritten_question,
    changed: result.changed,
    confidence: result.confidence,
    reason: result.reason,
    guard_applied: result.guard_applied === true,
    guard_reason: result.guard_reason,
    created_at: new Date().toISOString(),
  });

  return result;
}

function containsExplicitTopic(question: string): boolean {
  return [
    /\b(?:heart rate|pulse|blood pressure|glucose|wbc|hemoglobin|creatinine|aki|patient info|patient overview|demographics)\b/i,
    /心率/u,
    /脉搏/u,
    /血压/u,
    /血糖/u,
    /白细胞/u,
    /诊断/u,
    /字段/u,
    /患者信息/u,
    /基本信息/u,
  ].some((pattern) => pattern.test(question));
}

function hasProtectedPatientInfoKeyword(question: string): boolean {
  return PATIENT_INFO_GUARD_PATTERNS.some((pattern) => pattern.test(question));
}

function isAlreadyClearQuestion(question: string): boolean {
  const normalizedQuestion = normalizeText(question);

  if (ENGLISH_CLEAR_PATTERNS.some((pattern) => pattern.test(normalizedQuestion))) {
    return true;
  }

  if (
    containsExplicitTopic(normalizedQuestion) &&
    (/\b(?:what does|what is|what about)\b/i.test(normalizedQuestion) ||
      /(?:是什么|什么意思|代表什么|最近|多少)/u.test(normalizedQuestion))
  ) {
    return true;
  }

  return false;
}

function isExplanationLikeQuestion(question: string): boolean {
  return (
    /\b(?:mean|meaning|measure|explain|definition)\b/i.test(question) ||
    /(?:浠€涔堟剰鎬潀鍚箟|瑙ｉ噴|浠ｈ〃浠€涔?)/u.test(question)
  );
}

function shouldAttemptRewrite(input: QueryRewriteInput): boolean {
  const question = normalizeText(input.question);
  if (!question) {
    return false;
  }

  if (isAlreadyClearQuestion(question)) {
    return false;
  }

  if (FOLLOW_UP_PREFIX_PATTERNS.some((pattern) => pattern.test(question))) {
    return true;
  }

  if (
    FOLLOW_UP_SUFFIX_PATTERNS.some((pattern) => pattern.test(question)) &&
    question.length <= 18
  ) {
    return true;
  }

  if (AMBIGUOUS_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(question))) {
    return true;
  }

  if (input.last_question_type && question.length <= 18) {
    return true;
  }

  if (hasUsableChatHistory(input.chat_history) && question.length <= 24) {
    return true;
  }

  return false;
}

function rewriteByStructuredTopic(question: string): RewriteIntent | null {
  if (/\b(?:heart rate|pulse|hr)\b/i.test(question) || /(?:心率|脉搏)/u.test(question)) {
    return {
      rewrite: "这个患者最近的心率情况如何？",
      confidence: 0.86,
      reason: "fallback_heart_rate",
    };
  }

  if (/\b(?:blood pressure|bp)\b/i.test(question) || /血压/u.test(question)) {
    return {
      rewrite: "这个患者最近的血压情况如何？",
      confidence: 0.86,
      reason: "fallback_blood_pressure",
    };
  }

  if (/\b(?:glucose|blood sugar)\b/i.test(question) || /血糖/u.test(question)) {
    return {
      rewrite: "这个患者最近的血糖情况如何？",
      confidence: 0.84,
      reason: "fallback_glucose",
    };
  }

  if (
    /\b(?:patient info|patient overview|basic info|basic information|demographics)\b/i.test(
      question,
    ) ||
    /(?:患者信息|病人信息|基本信息)/u.test(question)
  ) {
    return {
      rewrite: "这个患者的基本信息是什么？",
      confidence: 0.82,
      reason: "fallback_patient_info",
    };
  }

  if (/\b(?:diagnosis|diagnoses)\b/i.test(question) || /诊断/u.test(question)) {
    return {
      rewrite: "这个患者的诊断结果是什么？",
      confidence: 0.82,
      reason: "fallback_diagnosis",
    };
  }

  return null;
}

function rewriteByIntentOnly(
  question: string,
  input: QueryRewriteInput,
): RewriteIntent | null {
  if (/字段/u.test(question)) {
    return {
      rewrite: "这个字段是什么意思？",
      confidence: 0.7,
      reason: "fallback_field_explanation",
    };
  }

  if (/指标/u.test(question) || /\bthis metric\b/i.test(question)) {
    return {
      rewrite: "这个指标代表什么？",
      confidence: 0.68,
      reason: "fallback_metric_explanation",
    };
  }

  if (/最近一次/u.test(question) || /latest one/i.test(question)) {
    if (input.last_question_type === "lab_query") {
      return {
        rewrite: "这个患者最近一次的化验结果是什么？",
        confidence: 0.62,
        reason: "fallback_latest_lab",
      };
    }

    if (input.last_question_type === "vital_query") {
      return {
        rewrite: "这个患者最近一次的生命体征是什么？",
        confidence: 0.62,
        reason: "fallback_latest_vital",
      };
    }
  }

  return null;
}

function buildFallbackRewrite(input: QueryRewriteInput): RewriteIntent | null {
  const question = normalizeText(input.question);

  if (!question || isAlreadyClearQuestion(question)) {
    return null;
  }

  const directRewrite =
    rewriteByStructuredTopic(question) ?? rewriteByIntentOnly(question, input);
  if (directRewrite) {
    return directRewrite;
  }

  const historySignal = getLatestHistorySignal(input.chat_history);
  if (!historySignal) {
    return null;
  }

  const contextAwareInput = {
    ...input,
    last_question_type: input.last_question_type ?? historySignal.questionType,
  };

  if (!isExplanationLikeQuestion(question)) {
    const contextualStructuredRewrite = rewriteByStructuredTopic(
      `${question} ${historySignal.text}`,
    );
    if (contextualStructuredRewrite) {
      return contextualStructuredRewrite;
    }
  }

  return rewriteByIntentOnly(question, contextAwareInput);
}

function toResult(
  input: QueryRewriteInput,
  rewrite: string,
  source: QueryRewriteResult["source"],
  reason: string,
  confidence?: number,
): QueryRewriteResult {
  const originalQuestion = normalizeText(input.question);
  const rewrittenQuestion = normalizeText(rewrite || originalQuestion);
  const changed = rewrittenQuestion !== originalQuestion;

  return {
    enabled: QUERY_REWRITE_ENABLED,
    original_question: originalQuestion,
    rewritten_question: changed ? rewrittenQuestion : originalQuestion,
    changed,
    source: changed ? source : "none",
    confidence: changed ? confidence : undefined,
    reason,
  };
}

function buildFallbackResult(input: QueryRewriteInput): QueryRewriteResult | null {
  const fallbackRewrite = buildFallbackRewrite(input);
  if (!fallbackRewrite) {
    return null;
  }

  return toResult(
    input,
    fallbackRewrite.rewrite,
    "fallback",
    fallbackRewrite.reason,
    fallbackRewrite.confidence,
  );
}

function classify(question: string): ClassificationResult {
  return classifyQuestion(question);
}

function levenshteinDistance(left: string, right: string): number {
  const leftChars = [...left];
  const rightChars = [...right];
  const previousRow = Array.from({ length: rightChars.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < leftChars.length; leftIndex += 1) {
    let diagonal = previousRow[0];
    previousRow[0] = leftIndex + 1;

    for (let rightIndex = 0; rightIndex < rightChars.length; rightIndex += 1) {
      const temp = previousRow[rightIndex + 1];
      const cost = leftChars[leftIndex] === rightChars[rightIndex] ? 0 : 1;
      previousRow[rightIndex + 1] = Math.min(
        previousRow[rightIndex + 1] + 1,
        previousRow[rightIndex] + 1,
        diagonal + cost,
      );
      diagonal = temp;
    }
  }

  return previousRow[rightChars.length] ?? 0;
}

function isLargeShortRewrite(
  originalQuestion: string,
  rewrittenQuestion: string,
   hasContextualSupport: boolean,
): boolean {
  if (hasContextualSupport) {
    return false;
  }

  const originalLength = [...originalQuestion].length;
  if (originalLength === 0 || originalLength > SHORT_QUESTION_MAX_LENGTH) {
    return false;
  }

  if (containsExplicitTopic(originalQuestion)) {
    return false;
  }

  const maxLength = Math.max(
    [...originalQuestion].length,
    [...rewrittenQuestion].length,
    1,
  );
  const distanceRatio =
    levenshteinDistance(originalQuestion, rewrittenQuestion) / maxLength;

  return distanceRatio >= LARGE_REWRITE_DISTANCE_RATIO;
}

function evaluateRewriteGuard(
  input: QueryRewriteInput,
  candidateQuestion: string,
): RewriteGuardDecision {
  const originalQuestion = normalizeText(input.question);
  const rewrittenQuestion = normalizeText(candidateQuestion);

  if (!rewrittenQuestion || rewrittenQuestion === originalQuestion) {
    return {
      allowed: true,
      reason: "rewrite_unchanged",
    };
  }

  const originalClassification = classify(originalQuestion);
  const rewrittenClassification = classify(rewrittenQuestion);

  if (
    hasProtectedPatientInfoKeyword(originalQuestion) &&
    rewrittenClassification.routeType !== "patient_info"
  ) {
    return {
      allowed: false,
      reason: "protected_patient_info_keyword",
    };
  }

  if (
    originalClassification.routeType !== "knowledge_query" &&
    rewrittenClassification.routeType !== originalClassification.routeType
  ) {
    return {
      allowed: false,
      reason: "question_type_mismatch",
    };
  }

  if (
    isLargeShortRewrite(
      originalQuestion,
      rewrittenQuestion,
      input.last_question_type !== null || hasUsableChatHistory(input.chat_history),
    )
  ) {
    return {
      allowed: false,
      reason: "short_question_large_change",
    };
  }

  return {
    allowed: true,
    reason: "accepted",
  };
}

function validateRewriteCandidate(
  input: QueryRewriteInput,
  candidate: QueryRewriteResult,
  options: {
    allowFallback: boolean;
  },
): QueryRewriteResult {
  if (!candidate.changed) {
    return withGuardState(candidate, false, "rewrite_unchanged");
  }

  const decision = evaluateRewriteGuard(input, candidate.rewritten_question);
  if (decision.allowed) {
    return withGuardState(candidate, false, decision.reason);
  }

  if (options.allowFallback) {
    const fallbackCandidate = buildFallbackResult(input);
    if (
      fallbackCandidate &&
      fallbackCandidate.rewritten_question !== candidate.rewritten_question
    ) {
      const fallbackDecision = evaluateRewriteGuard(
        input,
        fallbackCandidate.rewritten_question,
      );

      if (fallbackDecision.allowed) {
        return withGuardState(fallbackCandidate, true, decision.reason);
      }
    }
  }

  return buildUnchangedResult(
    input,
    "rewrite_guard_rejected",
    true,
    decision.reason,
  );
}

async function tryLlmRewrite(input: QueryRewriteInput): Promise<QueryRewriteResult> {
  const originalQuestion = normalizeText(input.question);
  const historySummary = buildHistorySummary(input.chat_history);
  const scenario = getLlmScenario("queryRewrite");
  const result = await generateLlmJson<QueryRewritePayload>(
    [
      {
        role: "system",
        content: [
          "You rewrite short clinical follow-up questions into standalone questions for backend routing.",
          "Ambiguous follow-up questions are not considered clear and should usually be rewritten.",
          "You may use recent chat_history when it is provided.",
          "Only use information already present in the user question, last_question_type, and chat_history.",
          "Do not invent patient facts, metrics, diagnoses, dates, or field names.",
          "If the question is already clear, keep it unchanged.",
          "Prefer concise standalone rewrites that preserve routing intent.",
          "Examples:",
          "那心率呢？ -> 这个患者最近的心率情况如何？",
          "那血压呢？ -> 这个患者最近的血压情况如何？",
          "这个指标是什么意思？ -> 这个指标代表什么？",
          "这个字段呢？ -> 这个字段是什么意思？",
          "再看一下最近一次 -> 这个患者最近一次的结果是什么？",
          "And patient info? -> What is the patient's basic information?",
          "Return JSON only with keys: rewritten_question, changed, confidence, reason.",
          "confidence must be a number between 0 and 1.",
        ].join(" "),
      },
        {
          role: "user",
          content: JSON.stringify({
            hadm_id: input.hadm_id,
            last_question_type: input.last_question_type,
            question: originalQuestion,
            recent_chat_history: historySummary,
          }),
        },
      ],
      {
        temperature: scenario.temperature,
        maxOutputTokens: scenario.maxOutputTokens,
        topP: scenario.topP,
        operation: scenario.operation,
      },
      {
        name: "query_rewrite_payload",
        description:
          'An object like {"rewritten_question":"...","changed":true,"confidence":0.9,"reason":"..."} where rewritten_question is a string and changed is a boolean.',
        validate: (value: unknown): value is QueryRewritePayload => {
          if (!isRecord(value)) {
            return false;
          }

          if (typeof value.rewritten_question !== "string") {
            return false;
          }

          if (typeof value.changed !== "boolean") {
            return false;
          }

          if ("confidence" in value && typeof value.confidence !== "number") {
            return false;
          }

          if ("reason" in value && typeof value.reason !== "string") {
            return false;
          }

          return true;
        },
      },
    );

  const rewrittenQuestion =
    typeof result.data.rewritten_question === "string"
      ? normalizeText(result.data.rewritten_question)
      : originalQuestion;
  const changed =
    typeof result.data.changed === "boolean"
      ? result.data.changed && rewrittenQuestion !== originalQuestion
      : rewrittenQuestion !== originalQuestion;

  return {
    enabled: QUERY_REWRITE_ENABLED,
    original_question: originalQuestion,
    rewritten_question: changed ? rewrittenQuestion : originalQuestion,
    changed,
    source: changed ? "llm" : "none",
    confidence: changed ? clampConfidence(result.data.confidence, 0.8) : undefined,
    reason:
      typeof result.data.reason === "string" && result.data.reason.trim()
        ? result.data.reason.trim()
        : changed
          ? "llm_rewrite"
          : "llm_unchanged",
  };
}

function preferFallbackWhenLlmDoesNotRewrite(
  input: QueryRewriteInput,
  llmResult: QueryRewriteResult,
): QueryRewriteResult {
  if (llmResult.changed) {
    return llmResult;
  }

  return buildFallbackResult(input) ?? llmResult;
}

export async function rewriteQuery(
  input: QueryRewriteInput,
): Promise<QueryRewriteResult> {
  const originalQuestion = normalizeText(input.question);

  if (!originalQuestion) {
    return logRewrite(
      buildUnchangedResult(input, "empty_question", false, "empty_question"),
    );
  }

  if (!QUERY_REWRITE_ENABLED) {
    return logRewrite(
      buildUnchangedResult(
        input,
        "query_rewrite_disabled",
        false,
        "query_rewrite_disabled",
      ),
    );
  }

  if (!shouldAttemptRewrite(input)) {
    return logRewrite(
      buildUnchangedResult(
        input,
        "question_already_clear",
        false,
        "question_already_clear",
      ),
    );
  }

  const availability = getLlmAvailability();
  if (availability.enabled) {
    try {
      const candidate = preferFallbackWhenLlmDoesNotRewrite(
        input,
        await tryLlmRewrite(input),
      );

      return logRewrite(
        validateRewriteCandidate(input, candidate, {
          allowFallback: candidate.source === "llm",
        }),
      );
    } catch (error: unknown) {
      const fallbackCandidate = buildFallbackResult(input);
      if (fallbackCandidate) {
        return logRewrite(
          validateRewriteCandidate(input, fallbackCandidate, {
            allowFallback: false,
          }),
        );
      }

      const reason =
        error instanceof LlmClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : "query_rewrite_failed";

      return logRewrite(buildUnchangedResult(input, reason, false, reason));
    }
  }

  const fallbackCandidate = buildFallbackResult(input);
  if (fallbackCandidate) {
    return logRewrite(
      validateRewriteCandidate(input, fallbackCandidate, {
        allowFallback: false,
      }),
    );
  }

  return logRewrite(
    buildUnchangedResult(
      input,
      availability.reason ?? "rewrite_not_applied",
      false,
      availability.reason ?? "rewrite_not_applied",
    ),
  );
}
