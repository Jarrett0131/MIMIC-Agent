import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { runRagTool } from "../../agent/tools/ragTool";

/**
 * Wraps the existing local RAG retriever (docs/rag/) via runRagTool.
 *
 * Use this for definitional / explanatory questions about medical terms,
 * metrics, fields, or diagnoses — NOT for fetching a specific patient's data.
 */
export const retrieveKnowledgeTool = createTool({
  id: "retrieve-knowledge",
  description:
    "在本地医学知识库(docs/rag)中检索，用于解释医学术语、化验/体征指标含义、数据字段含义或诊断相关知识。当用户是在问『这个指标/术语/字段是什么意思』这类概念性问题（而非查询某位患者的具体数据）时使用。",
  inputSchema: z.object({
    question: z.string().min(1).describe("要检索/解释的问题或术语。"),
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    retriever: z.string(),
    answer_draft: z.string().optional(),
    reason: z.string().optional(),
    items: z.array(z.record(z.string(), z.any())),
  }),
  execute: async (inputData) => {
    // ToolContext requires an hadm_id; the RAG retriever only uses `question`,
    // so a placeholder is safe here.
    const result = await runRagTool(
      { hadm_id: 0, question: inputData.question },
      "knowledge_query",
    );
    const payload = result.data as {
      enabled: boolean;
      retriever: string;
      answer_draft?: string;
      reason?: string;
      items: unknown[];
    };
    return {
      enabled: payload.enabled,
      retriever: payload.retriever,
      answer_draft: payload.answer_draft,
      reason: payload.reason,
      items: Array.isArray(payload.items)
        ? (payload.items as Record<string, unknown>[])
        : [],
    };
  },
});
