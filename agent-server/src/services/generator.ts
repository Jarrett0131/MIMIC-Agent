import type {
  AnswerEvidenceLink,
  AskResponse,
  EvidenceItem,
  InternalQuestionType,
  StructuredQuestionType,
  ToolTraceItem,
  WorkflowStage,
} from "../types";
import { getLlmScenario } from "../config/llmScenarios";
import {
  isRecord,
  readDisplayValue,
  readNumberFromRecord,
  readStringFromRecord,
  toRecordArray,
} from "../utils/common";
import {
  generateLlmText,
  generateLlmTextStream,
  getLlmAvailability,
} from "./llmClient";

const STRUCTURED_LIMITATION = "以下回答基于患者的结构化医疗数据。";
const RAG_LIMITATION = "以下解释基于本地医学知识库。";
const LLM_GENERAL_LIMITATION =
  "注意：由于本地患者数据缺失，以下回答结合了可用信息与通用医学知识，仅供参考，不能替代专业医疗建议。";
const NO_DATA_FALLBACK_LIMITATION =
  "本地数据库中没有找到匹配的患者数据，以下回答基于通用医学知识。";

export type GeneratedAnswerResult = {
  response: AskResponse;
  answerChunks: string[];
  streamed: boolean;
};

type AnswerArtifacts = {
  answerChunks: string[];
  evidence: EvidenceItem[];
  limitation: string[];
  answerLinks: AnswerEvidenceLink[];
  streamed?: boolean;
};

type RagPayload = {
  answer_draft?: unknown;
  items?: unknown;
  reason?: unknown;
};

type AnswerStreamHandlers = {
  onAnswerDelta?: (delta: string, answer: string) => Promise<void> | void;
};

function isStructuredQuestionType(
  value: InternalQuestionType,
): value is StructuredQuestionType {
  return (
    value === "patient_info" ||
    value === "lab_query" ||
    value === "vital_query" ||
    value === "diagnosis_query"
  );
}

function joinAnswerChunks(chunks: string[]): string {
  return chunks.join("");
}

function buildOverviewAnswerChunks(patientOverview: Record<string, unknown>): string[] {
  const gender = readDisplayValue(patientOverview, "gender") ?? "未知";
  const age = readDisplayValue(patientOverview, "age") ?? "未知";
  const admittime = readDisplayValue(patientOverview, "admittime") ?? "未知";
  const dischtime = readDisplayValue(patientOverview, "dischtime") ?? "未知";
  const icuIntime = readDisplayValue(patientOverview, "icu_intime") ?? "未知";
  const icuOuttime = readDisplayValue(patientOverview, "icu_outtime") ?? "未知";

  return [
    "患者概况：",
    `性别 ${gender}，`,
    `年龄 ${age}，`,
    `入院时间 ${admittime}，`,
    `出院时间 ${dischtime}，`,
    `ICU 入室 ${icuIntime}，`,
    `ICU 出室 ${icuOuttime}。`,
  ];
}

function buildDiagnosisSummaryChunks(diagnoses: Record<string, unknown>[]): string[] {
  const chunks = ["已记录的诊断包括："];

  diagnoses.forEach((diagnosis, index) => {
    const icdCode = readStringFromRecord(diagnosis, "icd_code") ?? "未知";
    const icdVersion = readNumberFromRecord(diagnosis, "icd_version");
    const seqNum = readNumberFromRecord(diagnosis, "seq_num");
    const longTitle = readStringFromRecord(diagnosis, "long_title");
    const seqLabel = seqNum === null ? `第 ${index + 1} 项` : `序号 ${seqNum}`;
    const versionLabel = icdVersion === null ? "" : `（ICD-${icdVersion}）`;
    const titleLabel = longTitle ? `，${longTitle}` : "";
    const suffix = index === diagnoses.length - 1 ? "。" : "；";

    chunks.push(`${seqLabel}：编码 ${icdCode}${versionLabel}${titleLabel}${suffix}`);
  });

  return chunks;
}

function buildMeasurementValue(record: Record<string, unknown>): string {
  const numericValue = readDisplayValue(record, "valuenum");
  const rawValue = readDisplayValue(record, "value");
  const unit = readStringFromRecord(record, "valueuom") ?? "";
  const value = numericValue ?? rawValue ?? "未知";
  return unit ? `${value} ${unit}` : value;
}

function buildMeasurementAnswerChunks(record: Record<string, unknown>): string[] {
  const label = readStringFromRecord(record, "label") ?? "测量项";
  const value = buildMeasurementValue(record);
  const charttime = readStringFromRecord(record, "charttime") ?? "未知";

  return ["最新", label, "结果为", value, "，记录时间为", charttime, "。"];
}

function buildMeasurementAnswerLinkTemplate(record: Record<string, unknown>): {
  chunks: string[];
  links: Array<{
    chunkIndex: number;
    field: string;
  }>;
} {
  return {
    chunks: buildMeasurementAnswerChunks(record),
    links: [
      {
        chunkIndex: 1,
        field: "label",
      },
      {
        chunkIndex: 3,
        field: "value",
      },
      {
        chunkIndex: 5,
        field: "charttime",
      },
    ],
  };
}

function isRagPayload(value: unknown): value is RagPayload {
  return isRecord(value) && "answer_draft" in value && "items" in value;
}

function getRecordsFromCollection(value: unknown): Record<string, unknown>[] {
  if (isRecord(value) && "records" in value) {
    return toRecordArray(value.records);
  }

  return toRecordArray(value);
}

function buildEvidenceItems(
  questionType: InternalQuestionType,
  data: Record<string, unknown>,
): EvidenceItem[] {
  if (questionType === "patient_info") {
    const patientOverview = isRecord(data.patient_overview) ? data.patient_overview : null;
    if (!patientOverview || Object.keys(patientOverview).length === 0) {
      return [];
    }

    return [
      {
        type: "patient",
        title: "Patient overview",
        content: patientOverview,
      },
    ];
  }

  if (questionType === "diagnosis_query") {
    return toRecordArray(data.diagnoses).map((diagnosis, index) => ({
      type: "diagnosis",
      title: `Diagnosis ${index + 1}`,
      content: diagnosis,
    }));
  }

  if (questionType === "lab_query") {
    return getRecordsFromCollection(data.records).map((record, index) => ({
      type: "lab",
      title: readStringFromRecord(record, "label") ?? `Lab record ${index + 1}`,
      content: record,
    }));
  }

  if (questionType === "vital_query") {
    return getRecordsFromCollection(data.records).map((record, index) => ({
      type: "vital",
      title: readStringFromRecord(record, "label") ?? `Vital record ${index + 1}`,
      content: record,
    }));
  }

  if (!isRagPayload(data)) {
    return [];
  }

  return toRecordArray(data.items).map((item, index) => ({
    type: "text",
    title: readStringFromRecord(item, "title") ?? `Knowledge item ${index + 1}`,
    content: {
      source: readStringFromRecord(item, "source") ?? "docs/rag",
      title: readStringFromRecord(item, "title") ?? `Knowledge item ${index + 1}`,
      chunk: readStringFromRecord(item, "chunk") ?? "",
      score: readNumberFromRecord(item, "score"),
      category: readStringFromRecord(item, "category"),
      domain: readStringFromRecord(item, "domain"),
    },
  }));
}

function buildAnswerLinks(
  questionType: StructuredQuestionType,
  evidence: EvidenceItem[],
): AnswerEvidenceLink[] {
  if ((questionType !== "lab_query" && questionType !== "vital_query") || evidence.length === 0) {
    return [];
  }

  const latestEvidence = evidence[0];
  if (!isRecord(latestEvidence.content)) {
    return [];
  }

  const template = buildMeasurementAnswerLinkTemplate(latestEvidence.content);
  const linkByChunkIndex = new Map(
    template.links.map((entry) => [entry.chunkIndex, entry] as const),
  );
  const links: AnswerEvidenceLink[] = [];
  let cursor = 0;

  template.chunks.forEach((chunk, chunkIndex) => {
    const start = cursor;
    cursor += chunk.length;

    const link = linkByChunkIndex.get(chunkIndex);
    if (!link || !chunk.trim()) {
      return;
    }

    links.push({
      id: `${latestEvidence.type}-0-${link.field}-${start}`,
      text: chunk,
      start,
      end: start + chunk.length,
      evidence_type: latestEvidence.type,
      evidence_index: 0,
      field: link.field,
    });
  });

  return links;
}

function buildRagAnswerDraftFromItems(items: Record<string, unknown>[]): string {
  const [primary, secondary] = items;
  const primaryTitle = readStringFromRecord(primary, "title") ?? "";
  const primaryChunk = readStringFromRecord(primary, "chunk") ?? "";
  const primarySentence = [primaryTitle, primaryChunk].filter(Boolean).join("：");

  if (!secondary || secondary === primary) {
    return primarySentence;
  }

  const secondaryTitle = readStringFromRecord(secondary, "title") ?? "";
  const secondaryChunk = readStringFromRecord(secondary, "chunk") ?? "";
  const secondarySentence = [secondaryTitle, secondaryChunk].filter(Boolean).join("：");

  return [primarySentence, secondarySentence].filter(Boolean).join(" 补充说明：");
}

function buildRagMissAnswer(reason?: string | null): string {
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if (normalizedReason) {
    return `本地知识库中没有找到直接匹配的解释。${normalizedReason}`;
  }

  return "本地知识库中没有找到直接匹配的解释，请换一个更具体的术语、指标或字段名再试。";
}

function readRagEnhancementPayload(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const payload = data.rag_enhancement;
  return isRecord(payload) ? payload : null;
}

function isRagSupplementRelevant(
  questionType: StructuredQuestionType,
  item: Record<string, unknown>,
): boolean {
  const category = readStringFromRecord(item, "category") ?? "knowledge";
  const domain = readStringFromRecord(item, "domain") ?? "general";

  if (questionType === "lab_query") {
    return (
      ["metric", "term", "knowledge", "field"].includes(category) &&
      ["lab", "general"].includes(domain)
    );
  }

  if (questionType === "vital_query") {
    return (
      ["metric", "term", "knowledge", "field"].includes(category) &&
      ["vital", "general"].includes(domain)
    );
  }

  if (questionType === "diagnosis_query") {
    return (
      ["diagnosis", "term", "knowledge"].includes(category) &&
      ["diagnosis", "general"].includes(domain)
    );
  }

  return (
    ["field", "term", "knowledge"].includes(category) &&
    ["patient", "general"].includes(domain)
  );
}

function buildStructuredRagSupplement(
  questionType: StructuredQuestionType,
  data: Record<string, unknown>,
): Pick<AnswerArtifacts, "answerChunks" | "evidence" | "limitation"> | null {
  const payload = readRagEnhancementPayload(data);
  if (!payload || !isRagPayload(payload)) {
    return null;
  }

  const relevantItems = toRecordArray(payload.items)
    .filter((item) => isRagSupplementRelevant(questionType, item))
    .slice(0, 2);
  if (relevantItems.length === 0) {
    return null;
  }

  const answerDraft =
    readStringFromRecord(payload, "answer_draft") ??
    buildRagAnswerDraftFromItems(relevantItems);
  if (!answerDraft) {
    return null;
  }

  return {
    answerChunks: [" 补充解释：", answerDraft],
    evidence: buildEvidenceItems("knowledge_query", {
      ...payload,
      items: relevantItems,
      answer_draft: answerDraft,
    }).slice(0, 2),
    limitation: [RAG_LIMITATION],
  };
}

function mergeStructuredArtifacts(
  base: AnswerArtifacts,
  supplement: Pick<AnswerArtifacts, "answerChunks" | "evidence" | "limitation"> | null,
): AnswerArtifacts {
  if (!supplement) {
    return base;
  }

  return {
    ...base,
    answerChunks: [...base.answerChunks, ...supplement.answerChunks],
    evidence: [...base.evidence, ...supplement.evidence],
    limitation: [...new Set([...base.limitation, ...supplement.limitation])],
  };
}

async function generateLlmGeneralAnswer(
  questionType: StructuredQuestionType,
  originalQuestion: string,
  patientInfo?: Record<string, unknown>,
  streamHandlers?: AnswerStreamHandlers,
): Promise<{ chunks: string[]; limitation: string; streamed: boolean }> {
  const availability = getLlmAvailability();
  const scenario = getLlmScenario("generalAnswerFallback");

  if (!availability.enabled) {
    return {
      chunks: ["抱歉，当前没有可用的语言模型来生成补充回答。"],
      limitation: NO_DATA_FALLBACK_LIMITATION,
      streamed: false,
    };
  }

  try {
    let contextInfo = "";
    if (patientInfo && Object.keys(patientInfo).length > 0) {
      const subjectId = patientInfo.subject_id ?? "未知";
      const gender = patientInfo.gender ?? "未知";
      const age = patientInfo.age ?? "未知";
      contextInfo = `\n患者基本信息：\n- 患者 ID: ${subjectId}\n- 性别: ${gender}\n- 年龄: ${age}`;
    }

    const questionTypeLabels: Record<StructuredQuestionType, string> = {
      patient_info: "患者信息查询",
      lab_query: "化验结果查询",
      vital_query: "生命体征查询",
      diagnosis_query: "诊断信息查询",
    };

    const messages = [
      {
        role: "system" as const,
        content: scenario.systemPrompt,
      },
      {
        role: "user" as const,
        content: [
          `问题类型：${questionTypeLabels[questionType]}`,
          `用户问题：${originalQuestion}${contextInfo}`,
          "",
          "请先说明本地患者数据缺失，再基于通用医学知识提供帮助。",
        ].join("\n"),
      },
    ];

    const streamChunks: string[] = [];
    const result = streamHandlers?.onAnswerDelta
      ? await generateLlmTextStream(
          messages,
          {
            onDelta: async (delta, answer) => {
              streamChunks.push(delta);
              await streamHandlers.onAnswerDelta?.(delta, answer);
            },
          },
          {
            temperature: scenario.temperature,
            maxOutputTokens: scenario.maxOutputTokens,
            topP: scenario.topP,
            operation: scenario.operation,
          },
        )
      : await generateLlmText(messages, {
          temperature: scenario.temperature,
          maxOutputTokens: scenario.maxOutputTokens,
          topP: scenario.topP,
          operation: scenario.operation,
        });

    return {
      chunks: streamChunks.length > 0 ? streamChunks : [result.text],
      limitation: LLM_GENERAL_LIMITATION,
      streamed: result.streamed,
    };
  } catch {
    return {
      chunks: ["抱歉，暂时无法生成补充回答，请稍后再试。"],
      limitation: NO_DATA_FALLBACK_LIMITATION,
      streamed: false,
    };
  }
}

async function buildStructuredArtifacts(
  questionType: StructuredQuestionType,
  data: Record<string, unknown>,
  originalQuestion?: string,
  patientInfo?: Record<string, unknown>,
  streamHandlers?: AnswerStreamHandlers,
): Promise<AnswerArtifacts> {
  if (questionType === "patient_info") {
    const patientOverview = isRecord(data.patient_overview) ? data.patient_overview : null;

    if (!patientOverview || Object.keys(patientOverview).length === 0) {
      const llmResult = await generateLlmGeneralAnswer(
        questionType,
        originalQuestion || "这个患者的基本信息是什么？",
        patientInfo,
        streamHandlers,
      );
      return {
        answerChunks: llmResult.chunks,
        evidence: [],
        limitation: [llmResult.limitation, STRUCTURED_LIMITATION],
        answerLinks: [],
        streamed: llmResult.streamed,
      };
    }

    return mergeStructuredArtifacts(
      {
        answerChunks: buildOverviewAnswerChunks(patientOverview),
        evidence: buildEvidenceItems(questionType, data),
        limitation: [STRUCTURED_LIMITATION],
        answerLinks: [],
      },
      buildStructuredRagSupplement(questionType, data),
    );
  }

  if (questionType === "diagnosis_query") {
    const diagnoses = toRecordArray(data.diagnoses);

    if (diagnoses.length === 0) {
      const llmResult = await generateLlmGeneralAnswer(
        questionType,
        originalQuestion || "这个患者有哪些诊断？",
        patientInfo,
        streamHandlers,
      );
      return {
        answerChunks: llmResult.chunks,
        evidence: [],
        limitation: [llmResult.limitation, STRUCTURED_LIMITATION],
        answerLinks: [],
        streamed: llmResult.streamed,
      };
    }

    return mergeStructuredArtifacts(
      {
        answerChunks: buildDiagnosisSummaryChunks(diagnoses),
        evidence: buildEvidenceItems(questionType, data),
        limitation: [STRUCTURED_LIMITATION],
        answerLinks: [],
      },
      buildStructuredRagSupplement(questionType, data),
    );
  }

  if (questionType === "lab_query" || questionType === "vital_query") {
    const records = getRecordsFromCollection(data.records);

    if (records.length === 0) {
      const queryLabel = questionType === "lab_query" ? "化验结果" : "生命体征";
      const llmResult = await generateLlmGeneralAnswer(
        questionType,
        originalQuestion || `这个患者的${queryLabel}怎么样？`,
        patientInfo,
        streamHandlers,
      );
      return {
        answerChunks: llmResult.chunks,
        evidence: [],
        limitation: [llmResult.limitation, STRUCTURED_LIMITATION],
        answerLinks: [],
        streamed: llmResult.streamed,
      };
    }

    const evidence = buildEvidenceItems(questionType, data);
    const chunks: string[] = [];
    records.slice(0, 5).forEach((record, index) => {
      chunks.push(...buildMeasurementAnswerChunks(record));
      if (index < Math.min(records.length, 5) - 1) {
        chunks.push(" ");
      }
    });

    return mergeStructuredArtifacts(
      {
        answerChunks: chunks,
        evidence,
        limitation: [STRUCTURED_LIMITATION],
        answerLinks: buildAnswerLinks(questionType, evidence),
      },
      buildStructuredRagSupplement(questionType, data),
    );
  }

  return {
    answerChunks: ["暂不支持的结构化问题类型。"],
    evidence: [],
    limitation: ["未知问题类型。"],
    answerLinks: [],
  };
}

function buildRagArtifacts(
  questionType: InternalQuestionType,
  data: Record<string, unknown>,
): AnswerArtifacts {
  if (!isRagPayload(data)) {
    return {
      answerChunks: ["检索结果为空。"],
      evidence: [],
      limitation: [RAG_LIMITATION],
      answerLinks: [],
    };
  }

  const items = toRecordArray(data.items);
  if (items.length === 0) {
    return {
      answerChunks: [buildRagMissAnswer(readStringFromRecord(data, "reason"))],
      evidence: [],
      limitation: [RAG_LIMITATION],
      answerLinks: [],
    };
  }

  const answerDraft =
    readStringFromRecord(data, "answer_draft") ??
    buildRagAnswerDraftFromItems(items);

  return {
    answerChunks: [answerDraft],
    evidence: buildEvidenceItems(questionType, data),
    limitation: [RAG_LIMITATION],
    answerLinks: [],
  };
}

async function buildAnswerArtifacts(
  questionType: InternalQuestionType,
  data: Record<string, unknown>,
  originalQuestion?: string,
  patientInfo?: Record<string, unknown>,
  streamHandlers?: AnswerStreamHandlers,
): Promise<AnswerArtifacts> {
  if (isStructuredQuestionType(questionType)) {
    return buildStructuredArtifacts(
      questionType,
      data,
      originalQuestion,
      patientInfo,
      streamHandlers,
    );
  }

  return buildRagArtifacts(questionType, data);
}

function getRouteFamily(routeType: InternalQuestionType): "structured" | "rag" {
  return isStructuredQuestionType(routeType) ? "structured" : "rag";
}

export async function generateAnswer(
  routeType: InternalQuestionType,
  displayType: StructuredQuestionType,
  toolData: Record<string, unknown>,
  workflowState: WorkflowStage[],
  toolTrace: ToolTraceItem[],
  originalQuestion?: string,
  patientInfo?: Record<string, unknown>,
  streamHandlers?: AnswerStreamHandlers,
): Promise<GeneratedAnswerResult> {
  const finalWorkflowState: WorkflowStage[] = [...workflowState, "answering"];
  const artifacts = await buildAnswerArtifacts(
    routeType,
    toolData,
    originalQuestion,
    patientInfo,
    streamHandlers,
  );
  const answer = joinAnswerChunks(artifacts.answerChunks);

  return {
    answerChunks: artifacts.answerChunks,
    streamed: artifacts.streamed === true,
    response: {
      success: true,
      question_type: displayType,
      workflow_state: [...finalWorkflowState, "done"],
      answer,
      evidence: artifacts.evidence,
      tool_trace: toolTrace,
      limitation: artifacts.limitation,
      error: null,
      answer_links: artifacts.answerLinks,
      routing: {
        route_type: routeType,
        route_family: getRouteFamily(routeType),
      },
    },
  };
}
