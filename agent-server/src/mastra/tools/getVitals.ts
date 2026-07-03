import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { fetchRecentVitals } from "../../services/pythonClient";

const MEASUREMENT_LIMIT = 100;

/**
 * Wraps the existing pythonClient.fetchRecentVitals call.
 *
 * Like labs, data-service matches `keyword` as a case-insensitive substring of
 * the vital-sign label, so keyword must be an ENGLISH term (e.g. "heart rate",
 * "blood pressure", "temperature", "spo2"). The agent translates the user's
 * phrasing into the correct English term.
 */
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
