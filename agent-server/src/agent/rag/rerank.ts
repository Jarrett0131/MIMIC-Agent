import {
  cosineSimilarity,
  ensureEmbeddingCache,
  getQueryEmbedding,
  resolveRagExperimentConfig,
} from "./embeddingCache";
import type { RagRerankInput, RagExperimentDiagnostics } from "./embeddingTypes";
import type { RagMatch } from "./types";

function toScore(value: number): number {
  return Number(value.toFixed(6));
}

function updateMatchScore(
  item: RagMatch,
  lexicalScore: number,
  embeddingSimilarity: number,
  combinedScore: number,
): RagMatch {
  return {
    ...item,
    score: toScore(combinedScore * 100),
    embedding_similarity: toScore(embeddingSimilarity),
    lexical_score: toScore(lexicalScore),
    score_breakdown: {
      ...item.score_breakdown,
      rerank: toScore(combinedScore * 100),
      embedding_similarity: toScore(embeddingSimilarity),
    },
  };
}

export async function applyOptionalRerank(
  input: RagRerankInput,
): Promise<{
  items: RagMatch[];
  retriever: string;
  experiment: RagExperimentDiagnostics;
}> {
  const config = resolveRagExperimentConfig(input.experiment);
  const baseDiagnostics: RagExperimentDiagnostics = {
    enabled: config.rerankEnabled || config.embeddingCacheEnabled,
    applied: false,
    strategy: "embedding-cache-rerank",
    provider: config.embeddingProvider,
    model: config.embeddingModel,
    cache_path: config.embeddingCachePath,
    candidate_count: input.baselineItems.length,
    rescored_count: 0,
  };

  if (!config.rerankEnabled) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "Rerank is disabled.",
      },
    };
  }

  if (!config.embeddingCacheEnabled) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "Embedding cache is disabled.",
      },
    };
  }

  if (input.baselineItems.length === 0) {
    return {
      items: [],
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: "No baseline candidates were available for reranking.",
      },
    };
  }

  const cacheEntries = [...input.corpusEntriesById.values()];

  const cacheResult = await ensureEmbeddingCache(cacheEntries, input.experiment);
  if (!cacheResult.cache) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: cacheResult.reason ?? "Embedding cache is unavailable.",
      },
    };
  }

  const queryEmbeddingResult = await getQueryEmbedding(input.question, input.experiment);
  if (!queryEmbeddingResult.vector) {
    return {
      items: input.baselineItems.slice(0, input.limit),
      retriever: "hybrid",
      experiment: {
        ...baseDiagnostics,
        reason: queryEmbeddingResult.reason ?? "Query embedding is unavailable.",
      },
    };
  }

  const vectorById = new Map(cacheResult.cache.entries.map((entry) => [entry.id, entry.vector]));
  const maxLexicalScore = Math.max(...input.baselineItems.map((item) => item.score), 1);
  const reranked = input.baselineItems
    .map((item, index) => {
      const vector = vectorById.get(item.id);
      const lexicalScore = item.score / maxLexicalScore;
      const embeddingSimilarity =
        vector && queryEmbeddingResult.vector
          ? (cosineSimilarity(queryEmbeddingResult.vector, vector) + 1) / 2
          : 0;
      const combinedScore = lexicalScore * 0.45 + embeddingSimilarity * 0.55;

      return {
        match: updateMatchScore(item, lexicalScore, embeddingSimilarity, combinedScore),
        combinedScore,
        index,
      };
    })
    .sort((left, right) => {
      if (right.combinedScore === left.combinedScore) {
        return left.index - right.index;
      }

      return right.combinedScore - left.combinedScore;
    })
    .slice(0, input.limit)
    .map((item) => item.match);

  return {
    items: reranked,
    retriever: "hybrid+embedding-cache-rerank",
    experiment: {
      ...baseDiagnostics,
      applied: true,
      rescored_count: reranked.length,
    },
  };
}
