import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  LLM_API_KEY,
  LLM_BASE_URL,
  RAG_EMBEDDING_CACHE_ENABLED,
  RAG_EMBEDDING_CACHE_PATH,
  RAG_EMBEDDING_DIMENSIONS,
  RAG_EMBEDDING_MODEL,
  RAG_EMBEDDING_PROVIDER,
  RAG_RERANK_CANDIDATE_LIMIT,
  RAG_RERANK_ENABLED,
} from "../../config";
import { writeStructuredLog } from "../../logging/logger";
import type { RagEntry } from "./types";
import type {
  EmbeddingProvider,
  RagEmbeddingCacheFile,
  RagEmbeddingCacheItem,
  RagEmbeddingCacheResult,
  RagExperimentOverrides,
  ResolvedRagExperimentConfig,
} from "./embeddingTypes";

const CACHE_VERSION = 1;

const inMemoryCache = new Map<string, RagEmbeddingCacheFile>();

function isEmbeddingProvider(value: string): value is EmbeddingProvider {
  return value === "local" || value === "openai";
}

function toAbsoluteCachePath(cachePath: string): string {
  if (path.isAbsolute(cachePath)) {
    return cachePath;
  }

  const candidates = [
    path.resolve(process.cwd(), cachePath),
    path.resolve(process.cwd(), "agent-server", cachePath),
    path.resolve(__dirname, "../../../../", cachePath),
  ];

  const existing = candidates.find((candidate) => {
    const normalizedCandidate = path.normalize(candidate);
    const normalizedRoot = path.normalize(path.resolve(__dirname, "../../../../"));
    return normalizedCandidate.startsWith(normalizedRoot);
  });

  return existing ?? path.resolve(process.cwd(), cachePath);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const tokens = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]{1,}/g) ?? [];
  const expanded: string[] = [];

  tokens.forEach((token) => {
    expanded.push(token);

    if (/^[\u4e00-\u9fff]+$/u.test(token)) {
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          expanded.push(token.slice(index, index + size));
        }
      }
    }
  });

  return expanded.filter((token) => token.length >= 2);
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector.map(() => 0);
  }

  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function buildLocalEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  tokens.forEach((token) => {
    const digest = createHash("sha256").update(token).digest();
    const weight = 1 + Math.min(token.length, 12) / 12;

    for (let projection = 0; projection < 3; projection += 1) {
      const index = digest[projection] % dimensions;
      const sign = digest[projection + 8] % 2 === 0 ? 1 : -1;
      vector[index] += sign * weight;
    }
  });

  return normalizeVector(vector);
}

function buildEntryText(entry: RagEntry): string {
  return [
    entry.title,
    entry.aliases.join(" "),
    entry.keywords.join(" "),
    entry.content,
  ]
    .join("\n")
    .trim();
}

function buildContentHash(entry: RagEntry): string {
  return createHash("sha256").update(buildEntryText(entry)).digest("hex");
}

async function requestOpenAiEmbedding(input: string, model: string): Promise<number[]> {
  if (!LLM_API_KEY) {
    throw new Error("LLM_API_KEY is not configured.");
  }

  const response = await fetch(`${LLM_BASE_URL.replace(/\/+$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Embedding request failed with status ${response.status}: ${detail || "empty response body"}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{
      embedding?: number[];
    }>;
  };
  const vector = payload.data?.[0]?.embedding;

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embedding response did not include a usable vector.");
  }

  return normalizeVector(vector.map((value) => Number(value)));
}

async function embedText(
  text: string,
  config: ResolvedRagExperimentConfig,
): Promise<number[]> {
  if (config.embeddingProvider === "local") {
    return buildLocalEmbedding(text, config.embeddingDimensions);
  }

  return requestOpenAiEmbedding(text, config.embeddingModel);
}

function isValidCacheFile(
  cache: RagEmbeddingCacheFile,
  entries: RagEntry[],
  config: ResolvedRagExperimentConfig,
): boolean {
  if (
    cache.version !== CACHE_VERSION ||
    cache.provider !== config.embeddingProvider ||
    cache.model !== config.embeddingModel ||
    cache.dimensions !== config.embeddingDimensions ||
    cache.entries.length !== entries.length
  ) {
    return false;
  }

  const expectedHashes = new Map(entries.map((entry) => [entry.id, buildContentHash(entry)]));

  return cache.entries.every((item) => expectedHashes.get(item.id) === item.content_hash);
}

async function readCacheFile(
  cachePath: string,
): Promise<RagEmbeddingCacheFile | null> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as RagEmbeddingCacheFile;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheFile(
  cachePath: string,
  cache: RagEmbeddingCacheFile,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function buildCacheFile(
  entries: RagEntry[],
  config: ResolvedRagExperimentConfig,
): Promise<RagEmbeddingCacheFile> {
  const cacheEntries: RagEmbeddingCacheItem[] = [];

  for (const entry of entries) {
    const vector = await embedText(buildEntryText(entry), config);
    cacheEntries.push({
      id: entry.id,
      title: entry.title,
      source: entry.source,
      content_hash: buildContentHash(entry),
      vector,
    });
  }

  return {
    version: CACHE_VERSION,
    provider: config.embeddingProvider,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    generated_at: new Date().toISOString(),
    entries: cacheEntries,
  };
}

export function resolveRagExperimentConfig(
  overrides: RagExperimentOverrides = {},
): ResolvedRagExperimentConfig {
  const provider =
    overrides.embeddingProvider ?? (isEmbeddingProvider(RAG_EMBEDDING_PROVIDER) ? RAG_EMBEDDING_PROVIDER : "local");

  return {
    rerankEnabled: overrides.rerankEnabled ?? RAG_RERANK_ENABLED,
    embeddingCacheEnabled: overrides.embeddingCacheEnabled ?? RAG_EMBEDDING_CACHE_ENABLED,
    embeddingProvider: provider,
    embeddingModel: overrides.embeddingModel ?? RAG_EMBEDDING_MODEL,
    embeddingCachePath: toAbsoluteCachePath(
      overrides.embeddingCachePath ?? RAG_EMBEDDING_CACHE_PATH,
    ),
    candidateLimit: overrides.candidateLimit ?? RAG_RERANK_CANDIDATE_LIMIT,
    embeddingDimensions: overrides.embeddingDimensions ?? RAG_EMBEDDING_DIMENSIONS,
  };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  return Number(
    left.reduce((sum, value, index) => sum + value * right[index], 0).toFixed(8),
  );
}

export async function getQueryEmbedding(
  question: string,
  overrides: RagExperimentOverrides = {},
): Promise<{ vector?: number[]; reason?: string; config: ResolvedRagExperimentConfig }> {
  const config = resolveRagExperimentConfig(overrides);

  try {
    return {
      vector: await embedText(question, config),
      config,
    };
  } catch (error: unknown) {
    return {
      config,
      reason:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to build query embedding.",
    };
  }
}

export async function ensureEmbeddingCache(
  entries: RagEntry[],
  overrides: RagExperimentOverrides = {},
): Promise<RagEmbeddingCacheResult> {
  const config = resolveRagExperimentConfig(overrides);

  if (!config.embeddingCacheEnabled) {
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      reason: "Embedding cache is disabled.",
    };
  }

  const memoryKey = `${config.embeddingProvider}:${config.embeddingModel}:${config.embeddingCachePath}`;
  const memoryCache = inMemoryCache.get(memoryKey);
  if (memoryCache && isValidCacheFile(memoryCache, entries, config)) {
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      cache: memoryCache,
    };
  }

  const diskCache = await readCacheFile(config.embeddingCachePath);
  if (diskCache && isValidCacheFile(diskCache, entries, config)) {
    inMemoryCache.set(memoryKey, diskCache);
    return {
      cachePath: config.embeddingCachePath,
      created: false,
      cache: diskCache,
    };
  }

  try {
    const cache = await buildCacheFile(entries, config);
    await writeCacheFile(config.embeddingCachePath, cache);
    inMemoryCache.set(memoryKey, cache);

    writeStructuredLog("rag.embedding_cache.ready", {
      cache_path: config.embeddingCachePath,
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      entries: cache.entries.length,
      created_at: new Date().toISOString(),
    });

    return {
      cachePath: config.embeddingCachePath,
      created: true,
      cache,
    };
  } catch (error: unknown) {
    const reason =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Failed to build embedding cache.";

    writeStructuredLog("rag.embedding_cache.failed", {
      cache_path: config.embeddingCachePath,
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      detail: reason,
      created_at: new Date().toISOString(),
    });

    return {
      cachePath: config.embeddingCachePath,
      created: false,
      reason,
    };
  }
}
