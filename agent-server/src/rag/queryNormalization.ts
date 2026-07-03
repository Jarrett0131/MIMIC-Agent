import { RAG_LLM_QUERY_ENABLED } from "../../config";
import { getLlmScenario } from "../../config/llmScenarios";
import { writeStructuredLog } from "../../logging/logger";
import {
  generateLlmJson,
  getLlmAvailability,
  LlmClientError,
} from "../../services/llmClient";
import type { KnowledgeQuestionType } from "../../types";

type RagQueryNormalizationPayload = {
  normalized_query?: string;
  changed?: boolean;
  reason?: string;
};

export type RagQueryNormalizationResult = {
  enabled: boolean;
  normalized_query: string;
  changed: boolean;
  source: "llm" | "none";
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function logNormalization(result: RagQueryNormalizationResult): RagQueryNormalizationResult {
  writeStructuredLog("rag.query_normalization", {
    enabled: result.enabled,
    changed: result.changed,
    source: result.source,
    normalized_query: result.normalized_query,
    reason: result.reason,
    created_at: new Date().toISOString(),
  });

  return result;
}

export async function normalizeRagQuery(input: {
  question: string;
  routeType: KnowledgeQuestionType;
}): Promise<RagQueryNormalizationResult> {
  const originalQuestion = normalizeText(input.question);

  if (!RAG_LLM_QUERY_ENABLED) {
    return logNormalization({
      enabled: false,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason: "rag_llm_query_disabled",
    });
  }

  const availability = getLlmAvailability();
  if (!availability.enabled) {
    return logNormalization({
      enabled: true,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason: availability.reason,
    });
  }

  try {
    const scenario = getLlmScenario("ragQueryNormalization");
    const result = await generateLlmJson<RagQueryNormalizationPayload>(
      [
        {
          role: "system",
          content: scenario.systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            route_type: input.routeType,
            question: originalQuestion,
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
        name: "rag_query_normalization_payload",
        description:
          'An object like {"normalized_query":"...","changed":true,"reason":"..."} where normalized_query is a string and changed is a boolean.',
        validate: (value: unknown): value is RagQueryNormalizationPayload => {
          if (!isRecord(value)) {
            return false;
          }

          if (typeof value.normalized_query !== "string") {
            return false;
          }

          if (typeof value.changed !== "boolean") {
            return false;
          }

          if ("reason" in value && typeof value.reason !== "string") {
            return false;
          }

          return true;
        },
      },
    );

    const normalizedQuery =
      typeof result.data.normalized_query === "string"
        ? normalizeText(result.data.normalized_query)
        : originalQuestion;
    const changed =
      typeof result.data.changed === "boolean"
        ? result.data.changed && normalizedQuery !== originalQuestion
        : normalizedQuery !== originalQuestion;

    return logNormalization({
      enabled: true,
      normalized_query: changed ? normalizedQuery : originalQuestion,
      changed,
      source: changed ? "llm" : "none",
      reason:
        typeof result.data.reason === "string" && result.data.reason.trim()
          ? result.data.reason.trim()
          : changed
            ? "rag_query_normalized"
            : "rag_query_unchanged",
    });
  } catch (error: unknown) {
    const reason =
      error instanceof LlmClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "rag_query_normalization_failed";

    return logNormalization({
      enabled: true,
      normalized_query: originalQuestion,
      changed: false,
      source: "none",
      reason,
    });
  }
}
