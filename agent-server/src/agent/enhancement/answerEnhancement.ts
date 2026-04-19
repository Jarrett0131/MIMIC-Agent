import { ANSWER_ENHANCEMENT_ENABLED } from "../../config";
import { getLlmScenario } from "../../config/llmScenarios";
import type { AnswerEvidenceLink, EvidenceItem } from "../../types";
import { writeStructuredLog } from "../../logging/logger";
import {
  generateLlmJson,
  getLlmAvailability,
  LlmClientError,
} from "../../services/llmClient";
import type { AnswerEnhancementInput, AnswerEnhancementResult } from "./types";

type AnswerEnhancementPayload = {
  enhanced_answer?: string;
  changed?: boolean;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readEvidenceValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function selectFields(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>((result, key) => {
    if (key in record && record[key] !== null && record[key] !== undefined) {
      result[key] = record[key];
    }

    return result;
  }, {});
}

function serializeEvidenceItem(item: EvidenceItem, index: number): string {
  if (!isRecord(item.content)) {
    return `Evidence ${index + 1} [${item.type}] ${item.title}: ${JSON.stringify(item.content)}`;
  }

  if (item.type === "patient") {
    return `Evidence ${index + 1} [${item.type}] ${item.title}: ${JSON.stringify(
      selectFields(item.content, [
        "gender",
        "age",
        "admittime",
        "dischtime",
        "icu_intime",
        "icu_outtime",
      ]),
    )}`;
  }

  if (item.type === "lab" || item.type === "vital") {
    return `Evidence ${index + 1} [${item.type}] ${item.title}: ${JSON.stringify(
      selectFields(item.content, [
        "label",
        "value",
        "valuenum",
        "valueuom",
        "charttime",
        "flag",
        "warning",
      ]),
    )}`;
  }

  if (item.type === "diagnosis") {
    return `Evidence ${index + 1} [diagnosis] ${item.title}: ${JSON.stringify(
      selectFields(item.content, ["icd_code", "icd_version", "seq_num", "long_title"]),
    )}`;
  }

  return `Evidence ${index + 1} [text] ${item.title}: ${JSON.stringify(item.content)}`;
}

function remapAnswerLinksSequentially(
  answer: string,
  links: AnswerEvidenceLink[],
): AnswerEvidenceLink[] | null {
  if (links.length === 0) {
    return [];
  }

  const remapped: AnswerEvidenceLink[] = [];
  let cursor = 0;

  for (const link of links) {
    const start = answer.indexOf(link.text, cursor);
    if (start < 0) {
      return null;
    }

    remapped.push({
      ...link,
      start,
      end: start + link.text.length,
    });
    cursor = start + link.text.length;
  }

  return remapped;
}

function extractNumericTokens(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?/g) ?? [];
}

function hasUnexpectedNumbers(originalAnswer: string, enhancedAnswer: string): boolean {
  const allowed = new Set(extractNumericTokens(originalAnswer));
  const enhancedNumbers = extractNumericTokens(enhancedAnswer);

  if (enhancedNumbers.length === 0) {
    return false;
  }

  return enhancedNumbers.some((token) => !allowed.has(token));
}

function buildEvidenceFieldCandidates(
  evidence: EvidenceItem,
  field: string | undefined,
): string[] {
  if (!field || !isRecord(evidence.content)) {
    return [];
  }

  const candidates = new Set<string>();
  const unit = readEvidenceValue(evidence.content, "valueuom");

  const addCandidate = (value: string | null): void => {
    if (!value) {
      return;
    }

    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return;
    }

    candidates.add(normalizedValue);

    if (unit && field === "value") {
      candidates.add(normalizeText(`${normalizedValue} ${unit}`));
    }
  };

  if (field === "value") {
    addCandidate(readEvidenceValue(evidence.content, "valuenum"));
    addCandidate(readEvidenceValue(evidence.content, "value"));
    return [...candidates];
  }

  addCandidate(readEvidenceValue(evidence.content, field));
  return [...candidates];
}

function validateAnswerLinksAgainstEvidence(
  answer: string,
  links: AnswerEvidenceLink[],
  evidence: EvidenceItem[],
): boolean {
  if (links.length === 0) {
    return true;
  }

  let previousEnd = -1;

  for (const link of links) {
    if (
      typeof link.start !== "number" ||
      typeof link.end !== "number" ||
      link.start < 0 ||
      link.end <= link.start ||
      link.end > answer.length ||
      link.start < previousEnd
    ) {
      return false;
    }

    if (answer.slice(link.start, link.end) !== link.text) {
      return false;
    }

    const evidenceItem = evidence[link.evidence_index];
    if (!evidenceItem || evidenceItem.type !== link.evidence_type) {
      return false;
    }

    const fieldCandidates = buildEvidenceFieldCandidates(evidenceItem, link.field);
    if (
      fieldCandidates.length > 0 &&
      !fieldCandidates.includes(normalizeText(link.text))
    ) {
      return false;
    }

    previousEnd = link.end;
  }

  return true;
}

function logEnhancement(result: AnswerEnhancementResult): AnswerEnhancementResult {
  writeStructuredLog("ask.answer_enhancement", {
    "ask.answer_enhancement.called": result.called,
    "ask.answer_enhancement.changed": result.changed,
    "ask.answer_enhancement.applied": result.applied,
    "ask.answer_enhancement.fallback": result.fallback,
    "ask.answer_enhancement.fallback_reason": result.fallback_reason,
    ask_answer_enhancement_called: result.called,
    ask_answer_enhancement_changed: result.changed,
    ask_answer_enhancement_applied: result.applied,
    ask_answer_enhancement_fallback: result.fallback,
    ask_answer_enhancement_fallback_reason: result.fallback_reason,
    enabled: result.enabled,
    called: result.called,
    changed: result.changed,
    applied: result.applied,
    fallback: result.fallback,
    reason: result.reason,
    fallback_reason: result.fallback_reason,
    created_at: new Date().toISOString(),
  });

  return result;
}

function buildResult(
  input: AnswerEnhancementInput,
  overrides: Partial<AnswerEnhancementResult>,
): AnswerEnhancementResult {
  return {
    enabled: ANSWER_ENHANCEMENT_ENABLED,
    called: false,
    original_answer: input.answer.trim(),
    enhanced_answer: input.answer.trim(),
    changed: false,
    applied: false,
    fallback: false,
    answer_links: input.answer_links,
    ...overrides,
  };
}

export async function enhanceAnswer(
  input: AnswerEnhancementInput,
): Promise<AnswerEnhancementResult> {
  const originalAnswer = input.answer.trim();

  if (!originalAnswer) {
    return logEnhancement(
      buildResult(input, {
        reason: "empty_answer",
      }),
    );
  }

  if (!ANSWER_ENHANCEMENT_ENABLED) {
    return logEnhancement(
      buildResult(input, {
        enabled: false,
        fallback: true,
        reason: "answer_enhancement_disabled",
        fallback_reason: "answer_enhancement_disabled",
      }),
    );
  }

  const availability = getLlmAvailability();
  if (!availability.enabled) {
    return logEnhancement(
      buildResult(input, {
        fallback: true,
        reason: availability.reason,
        fallback_reason: availability.reason,
      }),
    );
  }

  const evidenceSummary =
    input.evidence.length > 0
      ? input.evidence.map(serializeEvidenceItem).join("\n")
      : "No evidence items were provided.";
  const toolTraceSummary =
    input.tool_trace.length > 0
      ? JSON.stringify(input.tool_trace)
      : "No tool trace entries were provided.";
  const limitationSummary =
    input.limitation.length > 0 ? input.limitation.join(" | ") : "No additional limitations.";
  const scenario = getLlmScenario("answerEnhancement");

  try {
    const result = await generateLlmJson<AnswerEnhancementPayload>(
      [
        {
          role: "system",
          content: scenario.systemPrompt,
        },
        {
          role: "user",
          content: [
            `Question type: ${input.question_type}`,
            `Question: ${input.question}`,
            `Original answer: ${originalAnswer}`,
            `Limitations: ${limitationSummary}`,
            "Evidence:",
            evidenceSummary,
            "Tool trace:",
            toolTraceSummary,
          ].join("\n"),
        },
      ],
      {
        temperature: scenario.temperature,
        maxOutputTokens: scenario.maxOutputTokens,
        topP: scenario.topP,
        operation: scenario.operation,
      },
      {
        name: "answer_enhancement_payload",
        description:
          'An object like {"enhanced_answer":"...","changed":true,"reason":"..."} where enhanced_answer is a string and changed is a boolean.',
        validate: (value: unknown): value is AnswerEnhancementPayload => {
          if (!isRecord(value)) {
            return false;
          }

          if (typeof value.enhanced_answer !== "string") {
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

    const enhancedAnswer = normalizeText(
      typeof result.data.enhanced_answer === "string"
        ? result.data.enhanced_answer
        : originalAnswer,
    );

    if (!enhancedAnswer) {
      return logEnhancement(
        buildResult(input, {
          called: true,
          fallback: true,
          reason: "empty_enhanced_answer",
          fallback_reason: "empty_enhanced_answer",
        }),
      );
    }

    const changed =
      typeof result.data.changed === "boolean"
        ? result.data.changed && enhancedAnswer !== originalAnswer
        : enhancedAnswer !== originalAnswer;

    if (!changed) {
      return logEnhancement(
        buildResult(input, {
          called: true,
          reason:
            typeof result.data.reason === "string" && result.data.reason.trim()
              ? result.data.reason.trim()
              : "unchanged",
        }),
      );
    }

    if (hasUnexpectedNumbers(originalAnswer, enhancedAnswer)) {
      return logEnhancement(
        buildResult(input, {
          called: true,
          fallback: true,
          reason: "numeric_consistency_failed",
          fallback_reason: "numeric_consistency_failed",
        }),
      );
    }

    const remappedLinks = remapAnswerLinksSequentially(enhancedAnswer, input.answer_links);
    if (remappedLinks === null) {
      return logEnhancement(
        buildResult(input, {
          called: true,
          fallback: true,
          reason: "link_alignment_failed",
          fallback_reason: "link_alignment_failed",
        }),
      );
    }

    if (!validateAnswerLinksAgainstEvidence(enhancedAnswer, remappedLinks, input.evidence)) {
      return logEnhancement(
        buildResult(input, {
          called: true,
          fallback: true,
          reason: "link_evidence_validation_failed",
          fallback_reason: "link_evidence_validation_failed",
        }),
      );
    }

    return logEnhancement(
      buildResult(input, {
        called: true,
        enhanced_answer: enhancedAnswer,
        changed: true,
        applied: true,
        answer_links: remappedLinks,
        reason:
          typeof result.data.reason === "string" && result.data.reason.trim()
            ? result.data.reason.trim()
            : "answer_enhancement_applied",
      }),
    );
  } catch (error: unknown) {
    const reason =
      error instanceof LlmClientError
        ? error.message
        : error instanceof Error
          ? error.message
          : "answer_enhancement_failed";

    return logEnhancement(
      buildResult(input, {
        called: true,
        fallback: true,
        reason,
        fallback_reason: reason,
      }),
    );
  }
}
