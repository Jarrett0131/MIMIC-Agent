import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { fetchPatient } from "../../services/pythonClient";

/**
 * Mastra tool that wraps the existing pythonClient.fetchPatient call.
 *
 * This intentionally reuses the legacy data-service client (agent-server ->
 * data-service :8000) so the HTTP boundary defined in docs/architecture.md is
 * preserved. Nothing about the Python data layer changes.
 */
export const getPatientTool = createTool({
  id: "get-patient",
  description:
    "根据住院 ID (hadm_id) 获取该患者的结构化概况，包括人口学信息、入院/出院时间、ICU 出入室时间以及已记录的诊断。数据来自 MIMIC-IV data-service，不包含化验或生命体征明细。",
  inputSchema: z.object({
    hadm_id: z
      .number()
      .int()
      .positive()
      .describe("患者住院 ID (hadm_id)，正整数。"),
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
