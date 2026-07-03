import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { a as fetchRecentLabs } from '../pythonClient.mjs';
import 'axios';
import '../logger.mjs';
import 'dotenv';
import 'node:path';
import 'node:async_hooks';

const MEASUREMENT_LIMIT = 100;
const getLabsTool = createTool({
  id: "get-labs",
  description: "\u83B7\u53D6\u67D0\u60A3\u8005\u6700\u8FD1\u7684\u5316\u9A8C(\u68C0\u9A8C)\u7ED3\u679C\u3002keyword \u5FC5\u987B\u662F\u82F1\u6587\u5316\u9A8C\u9879\u540D\u79F0\u6216\u5176\u7247\u6BB5\uFF0C\u4F8B\u5982 glucose(\u8840\u7CD6)\u3001creatinine(\u808C\u9150)\u3001lactate(\u4E73\u9178)\u3001hemoglobin(\u8840\u7EA2\u86CB\u767D)\u3001white blood cell(\u767D\u7EC6\u80DE)\u3002\u8FD4\u56DE\u6309\u65F6\u95F4\u5012\u5E8F\u7684\u5316\u9A8C\u8BB0\u5F55\uFF08\u542B\u6570\u503C\u3001\u5355\u4F4D\u3001\u65F6\u95F4\uFF09\u3002\u6570\u636E\u6765\u81EA MIMIC-IV data-service\u3002",
  inputSchema: z.object({
    hadm_id: z.number().int().positive().describe("\u60A3\u8005\u4F4F\u9662 ID (hadm_id)\u3002"),
    keyword: z.string().min(1).describe(
      "\u82F1\u6587\u5316\u9A8C\u9879\u5173\u952E\u8BCD\uFF0C\u5982 glucose / creatinine / lactate / hemoglobin\u3002\u82E5\u7528\u6237\u7528\u4E2D\u6587\u63D0\u95EE\uFF0C\u8BF7\u7FFB\u8BD1\u4E3A\u5BF9\u5E94\u82F1\u6587\u9879\u540D\u3002"
    )
  }),
  outputSchema: z.object({
    hadm_id: z.number(),
    keyword: z.string(),
    records: z.array(z.record(z.string(), z.any()))
  }),
  execute: async (inputData) => {
    const data = await fetchRecentLabs(
      inputData.hadm_id,
      inputData.keyword,
      MEASUREMENT_LIMIT
    );
    return {
      hadm_id: data.hadm_id,
      keyword: data.keyword,
      records: Array.isArray(data.records) ? data.records : []
    };
  }
});

export { getLabsTool };
