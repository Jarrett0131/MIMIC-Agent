import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { retrieveRagMatches } from "../src/agent/rag/retriever";

describe("rag optional rerank layer", () => {
  it("keeps the baseline hybrid retriever unchanged when rerank is disabled", async () => {
    const baseline = await retrieveRagMatches({
      question: "WBC 是什么意思？",
      routeType: "metric_explanation",
      limit: 3,
    });

    const disabledExperiment = await retrieveRagMatches({
      question: "WBC 是什么意思？",
      routeType: "metric_explanation",
      limit: 3,
      experiment: {
        rerankEnabled: false,
        embeddingCacheEnabled: false,
      },
    });

    expect(baseline.retriever).toBe("hybrid");
    expect(disabledExperiment.retriever).toBe("hybrid");
    expect(disabledExperiment.items.map((item) => item.id)).toEqual(
      baseline.items.map((item) => item.id),
    );
  });

  it("degrades gracefully when rerank is enabled but embeddings are not configured", async () => {
    const result = await retrieveRagMatches({
      question: "charttime 是什么字段？",
      routeType: "field_explanation",
      limit: 3,
      experiment: {
        rerankEnabled: true,
        embeddingCacheEnabled: false,
      },
    });

    expect(result.retriever).toBe("hybrid");
    expect(result.experiment).toMatchObject({
      enabled: true,
      applied: false,
      reason: "Embedding cache is disabled.",
    });
  });

  it("can create a missing local embedding cache without breaking retrieval", async () => {
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "phase3-rag-cache-"));
    const cachePath = path.join(cacheDirectory, "rag_embeddings.json");

    const result = await retrieveRagMatches({
      question: "what does blood sugar mean?",
      routeType: "metric_explanation",
      limit: 3,
      experiment: {
        rerankEnabled: true,
        embeddingCacheEnabled: true,
        embeddingProvider: "local",
        embeddingModel: "token-hash-v1",
        embeddingCachePath: cachePath,
        embeddingDimensions: 96,
        candidateLimit: 6,
      },
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.retriever).toBe("hybrid+embedding-cache-rerank");
    expect(result.experiment).toMatchObject({
      enabled: true,
      applied: true,
    });
    await expect(fs.stat(cachePath)).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });
});

