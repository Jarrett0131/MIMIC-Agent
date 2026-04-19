import { AgentError } from "../core/errors/AgentError";
import { runRagTool } from "./tools/ragTool";
import {
  fetchDiagnoses,
  fetchPatient,
  fetchRecentLabs,
  fetchRecentVitals,
} from "../services/pythonClient";
import type {
  InternalQuestionType,
  KnowledgeQuestionType,
} from "../types";

const DEFAULT_LIMIT = 20;
const MEASUREMENT_EVIDENCE_LIMIT = 100;

type KeywordMatcher = {
  keyword: string;
  patterns: RegExp[];
};

export type ToolContext = {
  hadm_id: number;
  question: string;
};

export type ToolResult = {
  tool: string;
  args: Record<string, unknown>;
  data: unknown;
  result_count?: number;
};

export type ToolHandler = (ctx: ToolContext) => Promise<ToolResult>;

type ToolDefinition = {
  tool: string;
  buildArgs: (ctx: ToolContext) => Record<string, unknown>;
  handler: ToolHandler;
};

const LAB_KEYWORDS: KeywordMatcher[] = [
  {
    keyword: "lactate",
    patterns: [/\u4e73\u9178/u, /lactate/i],
  },
  {
    keyword: "creatinine",
    patterns: [/\u808c\u9150/u, /creatinine/i],
  },
  {
    keyword: "white",
    patterns: [/\u767d\u7ec6\u80de/u, /\bwbc\b/i, /white blood cell/i],
  },
  {
    keyword: "glucose",
    patterns: [/\u8840\u7cd6/u, /\u8461\u8404\u7cd6/u, /glucose/i, /blood sugar/i],
  },
  {
    keyword: "hemoglobin",
    patterns: [/\u8840\u7ea2\u86cb\u767d/u, /hemoglobin/i, /haemoglobin/i, /\bhb\b/i],
  },
];

const VITAL_KEYWORDS: KeywordMatcher[] = [
  {
    keyword: "heart rate",
    patterns: [/\u5fc3\u7387/u, /\u8109\u640f/u, /heart rate/i, /pulse/i, /\bhr\b/i],
  },
  {
    keyword: "blood pressure",
    patterns: [/\u8840\u538b/u, /blood pressure/i, /\bbp\b/i],
  },
  {
    keyword: "temperature",
    patterns: [/\u4f53\u6e29/u, /temperature/i],
  },
  {
    keyword: "spo2",
    patterns: [/\u8840\u6c27/u, /spo2/i, /oxygen saturation/i],
  },
];

function findKeyword(question: string, candidates: KeywordMatcher[]): string {
  const match = candidates.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(question.trim())),
  );

  if (!match) {
    throw new AgentError(
      "TOOL_ARGUMENT_NOT_SUPPORTED",
      "This demo supports only the predefined lab and vital keywords.",
      "router",
      {
        question,
      },
      400,
    );
  }

  return match.keyword;
}

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

function buildPatientArgs(ctx: ToolContext): Record<string, unknown> {
  return {
    hadm_id: ctx.hadm_id,
  };
}

async function getPatientTool(ctx: ToolContext): Promise<ToolResult> {
  const args = buildPatientArgs(ctx);
  const data = await fetchPatient(ctx.hadm_id);
  return {
    tool: "fetchPatient",
    args,
    data,
    result_count: inferResultCount(data),
  };
}

function buildDiagnosisArgs(ctx: ToolContext): Record<string, unknown> {
  return {
    hadm_id: ctx.hadm_id,
    limit: DEFAULT_LIMIT,
  };
}

async function getDiagnosesTool(ctx: ToolContext): Promise<ToolResult> {
  const args = buildDiagnosisArgs(ctx);
  const data = await fetchDiagnoses(ctx.hadm_id);
  return {
    tool: "fetchDiagnoses",
    args,
    data,
    result_count: inferResultCount(data),
  };
}

function buildLabArgs(ctx: ToolContext): Record<string, unknown> {
  return {
    hadm_id: ctx.hadm_id,
    keyword: findKeyword(ctx.question, LAB_KEYWORDS),
    limit: MEASUREMENT_EVIDENCE_LIMIT,
  };
}

async function getLabsTool(ctx: ToolContext): Promise<ToolResult> {
  const args = buildLabArgs(ctx);
  const keyword = typeof args.keyword === "string" ? args.keyword : "";
  const limit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;
  const data = await fetchRecentLabs(ctx.hadm_id, keyword, limit);
  return {
    tool: "fetchRecentLabs",
    args,
    data,
    result_count: inferResultCount(data),
  };
}

function buildVitalArgs(ctx: ToolContext): Record<string, unknown> {
  return {
    hadm_id: ctx.hadm_id,
    keyword: findKeyword(ctx.question, VITAL_KEYWORDS),
    limit: MEASUREMENT_EVIDENCE_LIMIT,
  };
}

async function getVitalsTool(ctx: ToolContext): Promise<ToolResult> {
  const args = buildVitalArgs(ctx);
  const keyword = typeof args.keyword === "string" ? args.keyword : "";
  const limit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;
  const data = await fetchRecentVitals(ctx.hadm_id, keyword, limit);
  return {
    tool: "fetchRecentVitals",
    args,
    data,
    result_count: inferResultCount(data),
  };
}

function buildRagArgs(
  ctx: ToolContext,
  questionType: KnowledgeQuestionType,
): Record<string, unknown> {
  return {
    question: ctx.question,
    route_type: questionType,
  };
}

function createRagTool(questionType: KnowledgeQuestionType): ToolDefinition {
  return {
    tool: "retrieveKnowledge",
    buildArgs: (ctx) => buildRagArgs(ctx, questionType),
    handler: (ctx) => runRagTool(ctx, questionType),
  };
}

const toolDefinitions: Record<InternalQuestionType, ToolDefinition> = {
  patient_info: {
    tool: "fetchPatient",
    buildArgs: buildPatientArgs,
    handler: getPatientTool,
  },
  diagnosis_query: {
    tool: "fetchDiagnoses",
    buildArgs: buildDiagnosisArgs,
    handler: getDiagnosesTool,
  },
  lab_query: {
    tool: "fetchRecentLabs",
    buildArgs: buildLabArgs,
    handler: getLabsTool,
  },
  vital_query: {
    tool: "fetchRecentVitals",
    buildArgs: buildVitalArgs,
    handler: getVitalsTool,
  },
  term_explanation: createRagTool("term_explanation"),
  metric_explanation: createRagTool("metric_explanation"),
  field_explanation: createRagTool("field_explanation"),
  knowledge_query: createRagTool("knowledge_query"),
};

export function resolveTool(
  questionType: InternalQuestionType,
  ctx: ToolContext,
): {
  tool: string;
  args: Record<string, unknown>;
  execute: () => Promise<ToolResult>;
} {
  const definition = toolDefinitions[questionType];

  if (!definition) {
    throw new AgentError(
      "TOOL_NOT_FOUND",
      `No tool registered for question type "${questionType}".`,
      "router",
      {
        question_type: questionType,
      },
      500,
    );
  }

  const args = definition.buildArgs(ctx);

  return {
    tool: definition.tool,
    args,
    execute: () => definition.handler(ctx),
  };
}
