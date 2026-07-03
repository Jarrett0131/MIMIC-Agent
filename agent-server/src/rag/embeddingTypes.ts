import type { RagEntry, RagMatch } from "./types";

export type EmbeddingProvider = "local" | "openai";

export type RagExperimentOverrides = Partial<{
  rerankEnabled: boolean;
  embeddingCacheEnabled: boolean;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingCachePath: string;
  candidateLimit: number;
  embeddingDimensions: number;
}>;

export type ResolvedRagExperimentConfig = {
  rerankEnabled: boolean;
  embeddingCacheEnabled: boolean;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  embeddingCachePath: string;
  candidateLimit: number;
  embeddingDimensions: number;
};

export type RagEmbeddingCacheItem = {
  id: string;
  title: string;
  source: string;
  content_hash: string;
  vector: number[];
};

export type RagEmbeddingCacheFile = {
  version: 1;
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  generated_at: string;
  entries: RagEmbeddingCacheItem[];
};

export type RagEmbeddingCacheResult = {
  cachePath: string;
  created: boolean;
  cache?: RagEmbeddingCacheFile;
  reason?: string;
};

export type RagExperimentDiagnostics = {
  enabled: boolean;
  applied: boolean;
  strategy?: "embedding-cache-rerank";
  provider?: EmbeddingProvider;
  model?: string;
  cache_path?: string;
  candidate_count: number;
  rescored_count: number;
  reason?: string;
};

export type RagRerankInput = {
  question: string;
  limit: number;
  baselineItems: RagMatch[];
  corpusEntriesById: Map<string, RagEntry>;
  experiment?: RagExperimentOverrides;
};

