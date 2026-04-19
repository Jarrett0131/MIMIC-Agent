import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRewriteQuery,
  mockEnhanceAnswer,
  mockRetrieveRagMatches,
} = vi.hoisted(() => ({
  mockRewriteQuery: vi.fn(),
  mockEnhanceAnswer: vi.fn(),
  mockRetrieveRagMatches: vi.fn(),
}));

vi.mock("../src/agent/enhancement/queryRewrite", () => ({
  rewriteQuery: mockRewriteQuery,
}));

vi.mock("../src/agent/enhancement/answerEnhancement", () => ({
  enhanceAnswer: mockEnhanceAnswer,
}));

vi.mock("../src/agent/rag/retriever", async () => {
  const actual = await vi.importActual<typeof import("../src/agent/rag/retriever")>(
    "../src/agent/rag/retriever",
  );

  return {
    ...actual,
    retrieveRagMatches: mockRetrieveRagMatches,
  };
});

import { parseAskRequest, runAskPipeline } from "../src/services/askPipeline";

describe("ask pipeline with RAG disabled", () => {
  beforeEach(() => {
    mockRewriteQuery.mockReset();
    mockEnhanceAnswer.mockReset();
    mockRetrieveRagMatches.mockReset();

    mockRewriteQuery.mockImplementation(async (input: { question: string }) => ({
      enabled: true,
      original_question: input.question,
      rewritten_question: input.question,
      changed: false,
      source: "none",
      reason: "question_already_clear",
    }));

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

    mockRetrieveRagMatches.mockResolvedValue({
      enabled: false,
      retriever: "hybrid",
      items: [],
      reason: "RAG is disabled by configuration.",
    });
  });

  it("returns a graceful degraded answer for knowledge requests", async () => {
    const payload = parseAskRequest({
      hadm_id: 101,
      question: "WBC \u662f\u4ec0\u4e48\u610f\u601d\uff1f",
      context: {
        hadm_id: 101,
        last_question_type: null,
      },
    });

    expect(payload).not.toBeNull();
    const result = await runAskPipeline(payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.response.routing).toEqual({
      route_type: "metric_explanation",
      route_family: "rag",
    });
    expect(result.response.answer).toContain("RAG is disabled by configuration.");
    expect(result.diagnostics.rag).toMatchObject({
      enabled: false,
      used: true,
      matched: false,
      reason: "RAG is disabled by configuration.",
    });
  });
});
