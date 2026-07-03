import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { Mastra } from "@mastra/core/mastra";

import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_PROVIDER } from "../config";
import {
  getDiagnosesTool,
  getLabsTool,
  getPatientTool,
  getVitalsTool,
  retrieveKnowledgeTool,
} from "./tools";

/** Reuse the existing LLM configuration (agent-server/.env), OpenAI-compatible. */
const model: MastraModelConfig = {
  id: `${LLM_PROVIDER}/${LLM_MODEL}` as `${string}/${string}`,
  url: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
};

/**
 * Unified MIMIC agent.
 *
 * Replaces the legacy regex classifier + static router: instead of
 * pattern-matching a question to one fixed tool, the LLM decides which tool(s)
 * to call via tool-calling. All five tools wrap the existing agent-server
 * logic, so the data boundary (agent-server -> data-service) is unchanged.
 */
export const mimicAgent = new Agent({
  id: "mimic-agent",
  name: "MIMIC Agent",
  instructions: [
    "你是一个专业、严谨的临床数据助手，服务于 MIMIC-IV 演示数据集。",
    "你的任务是根据用户的问题，选择合适的工具获取数据或知识，然后给出准确、简洁的中文回答。",
    "",
    "工具选择指南：",
    "- 患者基本情况 / 人口学 / 入出院 / ICU 时间：使用 get-patient。",
    "- 诊断 / ICD 编码：使用 get-diagnoses。",
    "- 化验/检验结果（如血糖、肌酐、乳酸、血红蛋白、白细胞）：使用 get-labs，keyword 传英文项名（把中文翻译成英文，如 血糖→glucose）。",
    "- 生命体征（如心率、血压、体温、血氧）：使用 get-vitals，keyword 传英文名（如 心率→heart rate）。",
    "- 概念性/解释性问题（某术语、指标、字段是什么意思）：使用 retrieve-knowledge。",
    "",
    "所有查询患者数据的工具都需要 hadm_id（住院 ID）。如果用户没有提供 hadm_id，请明确要求用户提供，不要臆造。",
    "允许在需要时调用多个工具（例如既查数据又检索该指标的解释）。",
    "只能基于工具返回的数据作答，不要编造患者事实、数值、时间或诊断编码。",
    "如果工具返回为空，如实说明本地数据库中没有找到对应数据。",
    "回答使用简洁、专业的中文。涉及诊断、治疗或风险判断时，提醒信息仅供参考，不能替代专业医生建议。",
  ].join("\n"),
  model,
  tools: {
    getPatient: getPatientTool,
    getDiagnoses: getDiagnosesTool,
    getLabs: getLabsTool,
    getVitals: getVitalsTool,
    retrieveKnowledge: retrieveKnowledgeTool,
  },
});

export const mastra = new Mastra({
  agents: { mimicAgent },
  server: {
    // Keep Studio / the Mastra dev server off :3001, which belongs to the
    // Express agent-server the frontend talks to.
    port: 4111,
  },
});
