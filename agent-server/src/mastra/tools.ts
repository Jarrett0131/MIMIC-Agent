import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { writeStructuredLog } from "../logging";
import { retrieveRagMatches } from "../rag/retriever";
import type { RagMatch } from "../rag/types";
import {
  fetchDiagnoses,
  fetchPatient,
  fetchRecentLabs,
  fetchRecentVitals,
} from "../services/pythonClient";

const MEASUREMENT_LIMIT = 100;

/**
 * Mastra tools for the MIMIC agent.
 *
 * Every structured tool wraps the existing pythonClient call (agent-server ->
 * data-service :8000), so the HTTP boundary defined in docs/architecture.md is
 * preserved: the Python data layer stays untouched.
 */

export const getPatientTool = createTool({
  id: "get-patient",
  description:
    "根据住院 ID (hadm_id) 获取该患者的结构化概况，包括人口学信息、入院/出院时间、ICU 出入室时间以及已记录的诊断。数据来自 MIMIC-IV data-service，不包含化验或生命体征明细。",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("患者住院 ID (hadm_id)，正整数。"),
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    patient_overview: z.record(z.string(), z.any()),
    diagnoses: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    const data = await fetchPatient(inputData.hadm_id);
    return {
      hadm_id: data.hadm_id,
      patient_overview: data.patient_overview ?? {},
      diagnoses: Array.isArray(data.diagnoses) ? data.diagnoses : [],
    };
  },
});

export const getDiagnosesTool = createTool({
  id: "get-diagnoses",
  description:
    "根据住院 ID (hadm_id) 获取该次住院已记录的诊断列表（ICD 编码、ICD 版本、序号，可能含诊断标题）。数据来自 MIMIC-IV data-service。",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("患者住院 ID (hadm_id)。"),
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    diagnoses: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    const data = await fetchDiagnoses(inputData.hadm_id);
    return {
      hadm_id: data.hadm_id,
      diagnoses: Array.isArray(data.diagnoses) ? data.diagnoses : [],
    };
  },
});

export const getLabsTool = createTool({
  id: "get-labs",
  description:
    "获取某患者最近的化验(检验)结果。keyword 必须是英文化验项名称或其片段，例如 glucose(血糖)、creatinine(肌酐)、lactate(乳酸)、hemoglobin(血红蛋白)、white blood cell(白细胞)。返回按时间倒序的化验记录（含数值、单位、时间）。数据来自 MIMIC-IV data-service。",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("患者住院 ID (hadm_id)。"),
    keyword: z
      .string()
      .min(1)
      .describe(
        "英文化验项关键词，如 glucose / creatinine / lactate / hemoglobin。若用户用中文提问，请翻译为对应英文项名。",
      ),
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    keyword: z.string(),
    records: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    const data = await fetchRecentLabs(
      inputData.hadm_id,
      inputData.keyword,
      MEASUREMENT_LIMIT,
    );
    return {
      hadm_id: data.hadm_id,
      keyword: data.keyword,
      records: Array.isArray(data.records) ? data.records : [],
    };
  },
});

export const getVitalsTool = createTool({
  id: "get-vitals",
  description:
    "获取某患者最近的生命体征。keyword 必须是英文体征名称或其片段，例如 heart rate(心率)、blood pressure(血压)、temperature(体温)、spo2(血氧饱和度)。返回按时间倒序的体征记录（含数值、单位、时间）。数据来自 MIMIC-IV data-service。",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("患者住院 ID (hadm_id)。"),
    keyword: z
      .string()
      .min(1)
      .describe(
        "英文体征关键词，如 heart rate / blood pressure / temperature / spo2。若用户用中文提问，请翻译为对应英文名。",
      ),
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    keyword: z.string(),
    records: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    const data = await fetchRecentVitals(
      inputData.hadm_id,
      inputData.keyword,
      MEASUREMENT_LIMIT,
    );
    return {
      hadm_id: data.hadm_id,
      keyword: data.keyword,
      records: Array.isArray(data.records) ? data.records : [],
    };
  },
});

function buildAnswerDraft(items: RagMatch[]): string | undefined {
  const [primary, secondary] = items;
  if (!primary) {
    return undefined;
  }

  const primarySentence = `${primary.title}：${primary.chunk}`;
  if (!secondary || secondary.id === primary.id) {
    return primarySentence;
  }

  return `${primarySentence} 补充说明：${secondary.title}：${secondary.chunk}`;
}

export const retrieveKnowledgeTool = createTool({
  id: "retrieve-knowledge",
  description:
    "在本地医学知识库(docs/rag)中检索，用于解释医学术语、化验/体征指标含义、数据字段含义或诊断相关知识。当用户是在问『这个指标/术语/字段是什么意思』这类概念性问题（而非查询某位患者的具体数据）时使用。知识库以英文术语为主，中文查询未命中时可改用英文术语重试。",
  inputSchema: z.object({
    question: z.string().min(1).describe("要检索/解释的问题或术语，优先使用英文术语。"),
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    retriever: z.string(),
    answer_draft: z.string().optional(),
    reason: z.string().optional(),
    items: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    const retrieval = await retrieveRagMatches({
      question: inputData.question,
      routeType: "knowledge_query",
      limit: 3,
    });

    writeStructuredLog("ask.rag", {
      question: inputData.question,
      retriever: retrieval.retriever,
      enabled: retrieval.enabled,
      matched: retrieval.items.length > 0,
      reason: retrieval.reason,
      top_results: retrieval.items.map((item) => ({
        title: item.title,
        source: item.source,
        score: item.score,
        category: item.category,
        domain: item.domain,
      })),
    });

    return {
      enabled: retrieval.enabled,
      retriever: retrieval.retriever,
      answer_draft: buildAnswerDraft(retrieval.items),
      reason: retrieval.reason,
      items: retrieval.items as unknown as Record<string, unknown>[],
    };
  },
});
