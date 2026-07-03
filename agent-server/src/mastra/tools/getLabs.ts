import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { fetchRecentLabs } from "../../services/pythonClient";

const MEASUREMENT_LIMIT = 100;

/**
 * Wraps the existing pythonClient.fetchRecentLabs call.
 *
 * data-service matches `keyword` as a case-insensitive substring of the lab
 * label, so the keyword must be an ENGLISH lab term (e.g. "glucose",
 * "creatinine", "lactate", "hemoglobin", "white blood cell"). The agent is
 * responsible for translating the user's phrasing (including Chinese) into the
 * correct English term — this replaces the legacy regex keyword whitelist.
 */
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
