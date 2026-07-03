import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { f as fetchDiagnoses } from '../pythonClient.mjs';
import 'axios';
import '../logger.mjs';
import 'dotenv';
import 'node:path';
import 'node:async_hooks';

const getDiagnosesTool = createTool({
  id: "get-diagnoses",
  description: "\u6839\u636E\u4F4F\u9662 ID (hadm_id) \u83B7\u53D6\u8BE5\u6B21\u4F4F\u9662\u5DF2\u8BB0\u5F55\u7684\u8BCA\u65AD\u5217\u8868\uFF08ICD \u7F16\u7801\u3001ICD \u7248\u672C\u3001\u5E8F\u53F7\uFF0C\u53EF\u80FD\u542B\u8BCA\u65AD\u6807\u9898\uFF09\u3002\u6570\u636E\u6765\u81EA MIMIC-IV data-service\u3002",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("\u60A3\u8005\u4F4F\u9662 ID (hadm_id)\u3002")
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    diagnoses: z.array(z.record(z.string(), z.any()))
  }),
  execute: async (inputData) => {
    const data = await fetchDiagnoses(inputData.hadm_id);
    return {
      hadm_id: data.hadm_id,
      diagnoses: Array.isArray(data.diagnoses) ? data.diagnoses : []
    };
  }
});

export { getDiagnosesTool };
