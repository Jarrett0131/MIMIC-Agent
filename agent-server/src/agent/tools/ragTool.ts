import { writeStructuredLog } from "../../logging/logger";
import type { KnowledgeQuestionType } from "../../types";
import { retrieveRagMatches } from "../rag/retriever";
import type { RagExperimentDiagnostics } from "../rag/embeddingTypes";
import type { RagMatch } from "../rag/types";
import type { ToolContext, ToolResult } from "../toolRegistry";

type RagToolPayload = {
  enabled: boolean;
  question: string;
  route_type: KnowledgeQuestionType;
  retriever: string;
  items: RagMatch[];
  answer_draft?: string;
  reason?: string;
  experiment?: RagExperimentDiagnostics;
};

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

export async function runRagTool(
  ctx: ToolContext,
  routeType: KnowledgeQuestionType,
): Promise<ToolResult> {
  const retrieval = await retrieveRagMatches({
    question: ctx.question,
    routeType,
    limit: 3,
  });

  writeStructuredLog("ask.rag", {
    question: ctx.question,
    route_type: routeType,
    retriever: retrieval.retriever,
    enabled: retrieval.enabled,
    matched: retrieval.items.length > 0,
    reason: retrieval.reason,
    knowledge_types: [...new Set(retrieval.items.map((item) => item.category))],
    experiment: retrieval.experiment,
    top_results: retrieval.items.map((item) => ({
      title: item.title,
      source: item.source,
      score: item.score,
      category: item.category,
      domain: item.domain,
      matched_terms: item.matched_terms,
      score_breakdown: item.score_breakdown,
      lexical_score: item.lexical_score,
      embedding_similarity: item.embedding_similarity,
    })),
    created_at: new Date().toISOString(),
  });

  const payload: RagToolPayload = {
    enabled: retrieval.enabled,
    question: ctx.question,
    route_type: routeType,
    retriever: retrieval.retriever,
    items: retrieval.items,
    answer_draft: buildAnswerDraft(retrieval.items),
    reason: retrieval.reason,
    experiment: retrieval.experiment,
  };

  return {
    tool: "retrieveKnowledge",
    args: {
      question: ctx.question,
      route_type: routeType,
      retriever: retrieval.retriever,
    },
    data: payload,
    result_count: retrieval.items.length,
  };
}
