import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { b as fetchPatient } from '../pythonClient.mjs';
import 'axios';
import '../logger.mjs';
import 'dotenv';
import 'node:path';
import 'node:async_hooks';

const getPatientTool = createTool({
  id: "get-patient",
  description: "\u6839\u636E\u4F4F\u9662 ID (hadm_id) \u83B7\u53D6\u8BE5\u60A3\u8005\u7684\u7ED3\u6784\u5316\u6982\u51B5\uFF0C\u5305\u62EC\u4EBA\u53E3\u5B66\u4FE1\u606F\u3001\u5165\u9662/\u51FA\u9662\u65F6\u95F4\u3001ICU \u51FA\u5165\u5BA4\u65F6\u95F4\u4EE5\u53CA\u5DF2\u8BB0\u5F55\u7684\u8BCA\u65AD\u3002\u6570\u636E\u6765\u81EA MIMIC-IV data-service\uFF0C\u4E0D\u5305\u542B\u5316\u9A8C\u6216\u751F\u547D\u4F53\u5F81\u660E\u7EC6\u3002",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("\u60A3\u8005\u4F4F\u9662 ID (hadm_id)\uFF0C\u6B63\u6574\u6570\u3002")
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    patient_overview: z.record(z.string(), z.any()),
    diagnoses: z.array(z.record(z.string(), z.any()))
  }),
  execute: async (inputData) => {
    const data = await fetchPatient(inputData.hadm_id);
    return {
      hadm_id: data.hadm_id,
      patient_overview: data.patient_overview ?? {},
      diagnoses: Array.isArray(data.diagnoses) ? data.diagnoses : []
    };
  }
});

export { getPatientTool };
