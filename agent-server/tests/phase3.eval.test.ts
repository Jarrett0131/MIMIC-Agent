import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRewriteQuery,
  mockEnhanceAnswer,
} = vi.hoisted(() => ({
  mockRewriteQuery: vi.fn(),
  mockEnhanceAnswer: vi.fn(),
}));

vi.mock("../src/agent/enhancement/queryRewrite", () => ({
  rewriteQuery: mockRewriteQuery,
}));

vi.mock("../src/agent/enhancement/answerEnhancement", () => ({
  enhanceAnswer: mockEnhanceAnswer,
}));

import { runPhase3Evaluation } from "../src/evaluation/runPhase3Eval";

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

describe("phase3 evaluation runner", () => {
  beforeEach(() => {
    mockRewriteQuery.mockReset();
    mockEnhanceAnswer.mockReset();

    mockRewriteQuery.mockImplementation(
      async (input: { question: string }) => {
        if (input.question === "\u90a3\u8bca\u65ad\u5462\uff1f") {
          return {
            enabled: true,
            original_question: input.question,
            rewritten_question:
              "\u8fd9\u4e2a\u60a3\u8005\u7684\u8bca\u65ad\u7ed3\u679c\u662f\u4ec0\u4e48\uff1f",
            changed: true,
            source: "llm",
            confidence: 0.93,
            reason: "follow_up_completion",
            guard_applied: false,
            guard_reason: "accepted",
          };
        }

        return {
          enabled: true,
          original_question: input.question,
          rewritten_question: input.question,
          changed: false,
          source: "none",
          reason: "question_already_clear",
          guard_applied: false,
          guard_reason: "question_already_clear",
        };
      },
    );

    mockEnhanceAnswer.mockImplementation(
      async (input: { answer: string; answer_links: unknown[] }) => ({
        enabled: true,
        called: false,
        original_answer: input.answer,
        enhanced_answer: input.answer,
        changed: false,
        applied: false,
        fallback: true,
        answer_links: input.answer_links,
        reason: "llm_disabled",
        fallback_reason: "llm_disabled",
      }),
    );
  });

  it("generates json and markdown reports with llm metrics", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phase3-eval-"));
    const datasetPath = path.join(tempRoot, "evalset.json");
    const reportPath = path.join(tempRoot, "report.json");
    const markdownPath = path.join(tempRoot, "report.md");

    await writeJsonFile(datasetPath, {
      version: "phase3.test",
      default_hadm_id: 20626031,
      samples: [
        {
          id: "rag_wbc_test",
          category: "rag",
          question: "WBC \u662f\u4ec0\u4e48\u610f\u601d\uff1f",
          hadm_id: 20626031,
          expected_route: "metric_explanation",
          expected_tool: "retrieveKnowledge",
          expected_titles: ["WBC"],
          expected_keywords: ["\u767d\u7ec6\u80de", "\u611f\u67d3"],
          requires_evidence: true,
        },
        {
          id: "followup_test",
          category: "follow_up",
          question: "\u90a3\u8bca\u65ad\u5462\uff1f",
          hadm_id: 20626031,
          context: {
            hadm_id: 20626031,
            last_question_type: "patient_info",
          },
          expected_route: "diagnosis_query",
          expected_tool: "fetchDiagnoses",
          expected_rewrite: {
            trigger: true,
            changed: true,
          },
          requires_evidence: true,
        },
      ],
    });

    const report = await runPhase3Evaluation({
      mode: "offline",
      datasetPath,
      reportPath,
      markdownReportPath: markdownPath,
      experiment: {
        rerankEnabled: true,
        embeddingCacheEnabled: true,
        embeddingProvider: "local",
        embeddingModel: "token-hash-v1",
        embeddingCachePath: path.join(tempRoot, "cache", "rag_embeddings.json"),
        embeddingDimensions: 96,
        candidateLimit: 6,
      },
      quiet: true,
    });

    expect(report.metrics.route_accuracy).toBeGreaterThanOrEqual(0);
    expect(report.metrics.rewrite_by_llm_rate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.rewrite_by_fallback_rate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.answer_enhancement_applied_rate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.answer_enhancement_fallback_rate).toBeGreaterThanOrEqual(0);
    expect(report.experiment.enabled).toBe(true);

    const savedReport = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
      metrics?: Record<string, number>;
    };
    const markdown = await fs.readFile(markdownPath, "utf8");

    expect(savedReport.metrics).toHaveProperty("rewrite_by_llm_rate");
    expect(savedReport.metrics).toHaveProperty("rewrite_by_fallback_rate");
    expect(savedReport.metrics).toHaveProperty("answer_enhancement_applied_rate");
    expect(savedReport.metrics).toHaveProperty("answer_enhancement_fallback_rate");
    expect(markdown).toContain("Phase 3 Evaluation Report");
  });

  it("shows a clear error when the sample set is empty", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phase3-empty-eval-"));
    const datasetPath = path.join(tempRoot, "empty.json");

    await writeJsonFile(datasetPath, {
      version: "phase3.empty",
      default_hadm_id: 20626031,
      samples: [],
    });

    await expect(
      runPhase3Evaluation({
        mode: "offline",
        datasetPath,
        reportPath: path.join(tempRoot, "unused.json"),
        markdownReportPath: path.join(tempRoot, "unused.md"),
        quiet: true,
      }),
    ).rejects.toThrow("Evaluation dataset is empty.");
  });
});
