import {
  DEFINITION_PATTERNS,
  DIAGNOSIS_PATTERNS,
  EXPLANATION_INTENT_PATTERNS,
  FIELD_PATTERNS,
  LAB_METRIC_PATTERNS,
  QUESTION_RULES,
  RESULT_INTENT_PATTERNS,
  VITAL_METRIC_PATTERNS,
} from "../config/questionRules";
import type {
  KnowledgeQuestionType,
  StructuredQuestionType,
} from "../types";

export type ClassificationResult = {
  routeType: StructuredQuestionType | KnowledgeQuestionType;
  displayType: StructuredQuestionType;
  routeFamily: "structured" | "rag";
};

function matchesAny(question: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(question));
}

function buildStructuredResult(type: StructuredQuestionType): ClassificationResult {
  return {
    routeType: type,
    displayType: type,
    routeFamily: "structured",
  };
}

function buildRagResult(
  routeType: KnowledgeQuestionType,
  displayType: StructuredQuestionType,
): ClassificationResult {
  return {
    routeType,
    displayType,
    routeFamily: "rag",
  };
}

export function classifyQuestion(question: string): ClassificationResult {
  const normalizedQuestion = question.trim();

  const hasExplanationIntent = matchesAny(
    normalizedQuestion,
    EXPLANATION_INTENT_PATTERNS,
  );
  const hasDefinitionIntent = matchesAny(
    normalizedQuestion,
    DEFINITION_PATTERNS,
  );
  const hasFieldTerm = matchesAny(normalizedQuestion, FIELD_PATTERNS);
  const hasLabMetric = matchesAny(normalizedQuestion, LAB_METRIC_PATTERNS);
  const hasVitalMetric = matchesAny(normalizedQuestion, VITAL_METRIC_PATTERNS);
  const hasDiagnosisTerm = matchesAny(normalizedQuestion, DIAGNOSIS_PATTERNS);
  const hasResultIntent = matchesAny(normalizedQuestion, RESULT_INTENT_PATTERNS);
  const isExplanationLike = hasExplanationIntent || hasDefinitionIntent;

  if (hasFieldTerm && isExplanationLike) {
    return buildRagResult("field_explanation", "patient_info");
  }

  if ((hasLabMetric || hasVitalMetric) && isExplanationLike && !hasResultIntent) {
    return buildRagResult(
      "metric_explanation",
      hasVitalMetric ? "vital_query" : "lab_query",
    );
  }

  if (hasDiagnosisTerm && isExplanationLike && !hasResultIntent) {
    return buildRagResult("term_explanation", "diagnosis_query");
  }

  if (hasExplanationIntent) {
    return buildRagResult("knowledge_query", "patient_info");
  }

  const matchedRule = QUESTION_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(normalizedQuestion)),
  );

  if (matchedRule) {
    return buildStructuredResult(matchedRule.type);
  }

  // Fall back to a generic knowledge lookup when the question does not
  // map cleanly to the supported structured routes.
  return buildRagResult("knowledge_query", "patient_info");
}
