import fs from "node:fs/promises";
import path from "node:path";

import type { InternalQuestionType, StructuredQuestionType } from "../types";
import type {
  Phase3EvalCategory,
  Phase3EvalDataset,
  Phase3EvalSample,
  Phase3EvalTool,
} from "./types";

const REPO_ROOT = path.resolve(__dirname, "../../../");

const VALID_CATEGORIES = new Set<Phase3EvalCategory>(["structured", "rag", "follow_up"]);
const VALID_TOOLS = new Set<Phase3EvalTool>([
  "fetchPatient",
  "fetchDiagnoses",
  "fetchRecentLabs",
  "fetchRecentVitals",
  "retrieveKnowledge",
]);
const VALID_ROUTE_TYPES = new Set<InternalQuestionType>([
  "patient_info",
  "lab_query",
  "vital_query",
  "diagnosis_query",
  "term_explanation",
  "metric_explanation",
  "field_explanation",
  "knowledge_query",
]);
const VALID_STRUCTURED_TYPES = new Set<StructuredQuestionType>([
  "patient_info",
  "lab_query",
  "vital_query",
  "diagnosis_query",
]);

export class EvalDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalDatasetError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeStringArray(value: unknown, field: string, sampleId: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    throw new EvalDatasetError(`${sampleId}: "${field}" must be an array of non-empty strings.`);
  }

  return value.map((item) => item.trim());
}

function normalizeContext(
  value: unknown,
  sampleId: string,
): Phase3EvalSample["context"] {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new EvalDatasetError(`${sampleId}: "context" must be an object when provided.`);
  }

  const lastQuestionType = value.last_question_type;
  if (
    lastQuestionType !== undefined &&
    lastQuestionType !== null &&
    !VALID_STRUCTURED_TYPES.has(lastQuestionType as StructuredQuestionType)
  ) {
    throw new EvalDatasetError(
      `${sampleId}: "context.last_question_type" must be a structured question type.`,
    );
  }

  const hadmId = value.hadm_id;
  if (hadmId !== undefined && !isPositiveInteger(hadmId)) {
    throw new EvalDatasetError(`${sampleId}: "context.hadm_id" must be a positive integer.`);
  }

  return {
    hadm_id: hadmId as number | undefined,
    last_question_type: (lastQuestionType as StructuredQuestionType | null | undefined) ?? undefined,
  };
}

function normalizeSample(
  rawSample: unknown,
  defaultHadmId: number,
  index: number,
): Phase3EvalSample {
  if (!isRecord(rawSample)) {
    throw new EvalDatasetError(`Sample at index ${index} must be an object.`);
  }

  const sampleId = isNonEmptyString(rawSample.id) ? rawSample.id.trim() : `sample_${index + 1}`;
  if (!isNonEmptyString(rawSample.id)) {
    throw new EvalDatasetError(`${sampleId}: "id" is required.`);
  }

  if (!isNonEmptyString(rawSample.question)) {
    throw new EvalDatasetError(`${sampleId}: "question" is required.`);
  }

  if (!VALID_CATEGORIES.has(rawSample.category as Phase3EvalCategory)) {
    throw new EvalDatasetError(`${sampleId}: "category" is invalid.`);
  }

  if (!VALID_ROUTE_TYPES.has(rawSample.expected_route as InternalQuestionType)) {
    throw new EvalDatasetError(`${sampleId}: "expected_route" is invalid.`);
  }

  if (!VALID_TOOLS.has(rawSample.expected_tool as Phase3EvalTool)) {
    throw new EvalDatasetError(`${sampleId}: "expected_tool" is invalid.`);
  }

  const hadmId = rawSample.hadm_id === undefined ? defaultHadmId : rawSample.hadm_id;
  if (!isPositiveInteger(hadmId)) {
    throw new EvalDatasetError(`${sampleId}: "hadm_id" must be a positive integer.`);
  }

  const context = normalizeContext(rawSample.context, sampleId);
  if (rawSample.category === "follow_up" && !context?.last_question_type) {
    throw new EvalDatasetError(
      `${sampleId}: follow-up samples must provide "context.last_question_type".`,
    );
  }

  const expectedTitles = normalizeStringArray(
    rawSample.expected_titles,
    "expected_titles",
    sampleId,
  );
  if (rawSample.category === "rag" && (!expectedTitles || expectedTitles.length === 0)) {
    throw new EvalDatasetError(`${sampleId}: rag samples must provide "expected_titles".`);
  }

  const expectedKeywords = normalizeStringArray(
    rawSample.expected_keywords,
    "expected_keywords",
    sampleId,
  );

  const rewrite = rawSample.expected_rewrite;
  if (rewrite !== undefined) {
    if (!isRecord(rewrite) || typeof rewrite.trigger !== "boolean") {
      throw new EvalDatasetError(
        `${sampleId}: "expected_rewrite" must contain at least a boolean "trigger".`,
      );
    }

    if (rewrite.changed !== undefined && typeof rewrite.changed !== "boolean") {
      throw new EvalDatasetError(
        `${sampleId}: "expected_rewrite.changed" must be boolean when provided.`,
      );
    }

    if (
      rewrite.rewritten_contains !== undefined &&
      (!Array.isArray(rewrite.rewritten_contains) ||
        rewrite.rewritten_contains.some((item) => !isNonEmptyString(item)))
    ) {
      throw new EvalDatasetError(
        `${sampleId}: "expected_rewrite.rewritten_contains" must be a string array.`,
      );
    }
  }

  return {
    id: sampleId,
    category: rawSample.category as Phase3EvalCategory,
    question: rawSample.question.trim(),
    hadm_id: hadmId,
    language:
      rawSample.language === "zh" || rawSample.language === "en" || rawSample.language === "mixed"
        ? rawSample.language
        : undefined,
    context,
    expected_route: rawSample.expected_route as InternalQuestionType,
    expected_tool: rawSample.expected_tool as Phase3EvalTool,
    expected_titles: expectedTitles,
    expected_keywords: expectedKeywords,
    expected_rewrite:
      rewrite === undefined
        ? undefined
        : {
            trigger: rewrite.trigger as boolean,
            changed: rewrite.changed as boolean | undefined,
            rewritten_contains: rewrite.rewritten_contains as string[] | undefined,
          },
    requires_evidence:
      typeof rawSample.requires_evidence === "boolean" ? rawSample.requires_evidence : true,
    tags: normalizeStringArray(rawSample.tags, "tags", sampleId),
    notes: isNonEmptyString(rawSample.notes) ? rawSample.notes.trim() : undefined,
  };
}

export function getRepoPath(...segments: string[]): string {
  return path.resolve(REPO_ROOT, ...segments);
}

export function resolveEvalDatasetPath(datasetPath?: string): string {
  if (!datasetPath) {
    return getRepoPath("evaluation", "datasets", "phase3_evalset.json");
  }

  return path.isAbsolute(datasetPath) ? datasetPath : path.resolve(process.cwd(), datasetPath);
}

export async function loadPhase3EvalDataset(datasetPath?: string): Promise<{
  dataset: Phase3EvalDataset;
  path: string;
}> {
  const resolvedPath = resolveEvalDatasetPath(datasetPath);
  const rawText = await fs.readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(rawText) as unknown;

  if (!isRecord(parsed)) {
    throw new EvalDatasetError("Evaluation dataset root must be an object.");
  }

  if (!isNonEmptyString(parsed.version)) {
    throw new EvalDatasetError('"version" is required for the evaluation dataset.');
  }

  if (!isPositiveInteger(parsed.default_hadm_id)) {
    throw new EvalDatasetError('"default_hadm_id" must be a positive integer.');
  }

  if (!Array.isArray(parsed.samples)) {
    throw new EvalDatasetError('"samples" must be an array.');
  }

  if (parsed.samples.length === 0) {
    throw new EvalDatasetError("Evaluation dataset is empty.");
  }

  const samples = parsed.samples.map((sample, index) =>
    normalizeSample(sample, parsed.default_hadm_id as number, index),
  );
  const duplicateIds = samples
    .map((sample) => sample.id)
    .filter((sampleId, index, values) => values.indexOf(sampleId) !== index);

  if (duplicateIds.length > 0) {
    throw new EvalDatasetError(`Duplicate sample ids found: ${[...new Set(duplicateIds)].join(", ")}`);
  }

  return {
    path: resolvedPath,
    dataset: {
      version: parsed.version.trim(),
      default_hadm_id: parsed.default_hadm_id as number,
      samples,
    },
  };
}
