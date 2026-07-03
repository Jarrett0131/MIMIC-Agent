import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { fetchDiagnoses } from "../../services/pythonClient";

/** Wraps the existing pythonClient.fetchDiagnoses call (agent-server -> data-service). */
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
