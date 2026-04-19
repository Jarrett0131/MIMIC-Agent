import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchPatient,
  mockFetchDiagnoses,
  mockFetchRecentLabs,
  mockFetchRecentVitals,
  mockRewriteQuery,
  mockEnhanceAnswer,
} = vi.hoisted(() => ({
  mockFetchPatient: vi.fn(),
  mockFetchDiagnoses: vi.fn(),
  mockFetchRecentLabs: vi.fn(),
  mockFetchRecentVitals: vi.fn(),
  mockRewriteQuery: vi.fn(),
  mockEnhanceAnswer: vi.fn(),
}));

vi.mock("../src/services/pythonClient", async () => {
  const actual = await vi.importActual<typeof import("../src/services/pythonClient")>(
    "../src/services/pythonClient",
  );

  return {
    ...actual,
    fetchPatient: mockFetchPatient,
    fetchDiagnoses: mockFetchDiagnoses,
    fetchRecentLabs: mockFetchRecentLabs,
    fetchRecentVitals: mockFetchRecentVitals,
  };
});

vi.mock("../src/agent/enhancement/queryRewrite", () => ({
  rewriteQuery: mockRewriteQuery,
}));

vi.mock("../src/agent/enhancement/answerEnhancement", () => ({
  enhanceAnswer: mockEnhanceAnswer,
}));

import { parseAskRequest, runAskPipeline } from "../src/services/askPipeline";

describe("backend enhancement flow", () => {
  beforeEach(() => {
    mockFetchPatient.mockReset();
    mockFetchDiagnoses.mockReset();
    mockFetchRecentLabs.mockReset();
    mockFetchRecentVitals.mockReset();
    mockRewriteQuery.mockReset();
    mockEnhanceAnswer.mockReset();

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
  });

  it("keeps structured questions on the structured tool path and can enhance the final answer", async () => {
    mockFetchRecentLabs.mockResolvedValue({
      hadm_id: 101,
      keyword: "glucose",
      records: [
        {
          label: "Glucose",
          valuenum: 126,
          valueuom: "mg/dL",
          charttime: "2025-01-01T08:00:00Z",
        },
      ],
    });

    mockEnhanceAnswer.mockImplementation(
      async (input: { answer: string; answer_links: unknown[] }) => ({
        enabled: true,
        called: true,
        original_answer: input.answer,
        enhanced_answer: `${input.answer} Readability improved.`,
        changed: true,
        applied: true,
        fallback: false,
        answer_links: input.answer_links,
        reason: "answer_enhancement_applied",
      }),
    );

    const payload = parseAskRequest({
      hadm_id: 101,
      question: "latest glucose lab result",
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

    expect(mockFetchRecentLabs).toHaveBeenCalledWith(101, "glucose", 100);
    expect(result.response.question_type).toBe("lab_query");
    expect(result.response.routing).toEqual({
      route_type: "lab_query",
      route_family: "structured",
    });
    expect(result.response.tool_trace[0]?.tool).toBe("fetchRecentLabs");
    expect(result.response.enhancement?.answer_enhancement).toMatchObject({
      called: true,
      changed: true,
      applied: true,
      fallback: false,
    });
    expect(result.response.answer).toContain("Readability improved.");
  });

  it("rewrites a short follow-up and routes it to the correct structured tool", async () => {
    mockRewriteQuery.mockResolvedValue({
      enabled: true,
      original_question: "\u90a3\u5fc3\u7387\u5462\uff1f",
      rewritten_question: "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
      changed: true,
      source: "llm",
      confidence: 0.93,
      reason: "follow_up_completion",
    });

    mockFetchRecentVitals.mockResolvedValue({
      hadm_id: 101,
      keyword: "heart rate",
      records: [
        {
          label: "Heart Rate",
          valuenum: 98,
          valueuom: "bpm",
          charttime: "2025-01-01T08:05:00Z",
        },
      ],
    });

    const payload = parseAskRequest({
      hadm_id: 101,
      question: "\u90a3\u5fc3\u7387\u5462\uff1f",
      context: {
        hadm_id: 101,
        last_question_type: "lab_query",
      },
    });

    expect(payload).not.toBeNull();
    const result = await runAskPipeline(payload!);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(mockFetchRecentVitals).toHaveBeenCalledWith(101, "heart rate", 100);
    expect(result.response.question_type).toBe("vital_query");
    expect(result.response.enhancement?.query_rewrite).toMatchObject({
      changed: true,
      source: "llm",
      rewritten_question:
        "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
    });
    expect(result.diagnostics.rewrite).toMatchObject({
      changed: true,
      source: "llm",
      reason: "follow_up_completion",
    });
    expect(result.response.routing).toEqual({
      route_type: "vital_query",
      route_family: "structured",
    });
  });

  it("routes term explanation questions to rag and returns text evidence", async () => {
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
    expect(result.response.evidence[0]?.type).toBe("text");
    expect(result.response.tool_trace[0]?.tool).toBe("retrieveKnowledge");
    expect(result.response.answer.toLowerCase()).toContain("wbc");
    expect(result.diagnostics.rag).toMatchObject({
      used: true,
      matched: true,
      route_type: "metric_explanation",
    });
  });

  it("routes knowledge_query questions to rag even when no strong corpus match exists", async () => {
    const payload = parseAskRequest({
      hadm_id: 101,
      question: "\u8fd9\u4e2a\u672f\u8bed\u662f\u4ec0\u4e48\u610f\u601d\uff1f",
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
      route_type: "knowledge_query",
      route_family: "rag",
    });
    expect(result.response.tool_trace[0]?.tool).toBe("retrieveKnowledge");
    expect(result.diagnostics.rag?.used).toBe(true);
  });

  it("falls back to the original answer when answer enhancement cannot preserve links", async () => {
    mockFetchRecentLabs.mockResolvedValue({
      hadm_id: 101,
      keyword: "glucose",
      records: [
        {
          label: "Glucose",
          valuenum: 118,
          valueuom: "mg/dL",
          charttime: "2025-01-01T08:00:00Z",
        },
      ],
    });

    mockEnhanceAnswer.mockImplementation(
      async (input: { answer: string; answer_links: unknown[] }) => ({
        enabled: true,
        called: true,
        original_answer: input.answer,
        enhanced_answer: input.answer,
        changed: false,
        applied: false,
        fallback: true,
        answer_links: input.answer_links,
        reason: "link_alignment_failed",
        fallback_reason: "link_alignment_failed",
      }),
    );

    const payload = parseAskRequest({
      hadm_id: 101,
      question: "latest glucose lab result",
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

    expect(result.response.answer).toContain("Glucose");
    expect(result.response.enhancement?.answer_enhancement).toMatchObject({
      called: true,
      changed: false,
      applied: false,
      fallback: true,
      fallback_reason: "link_alignment_failed",
    });
    expect(result.diagnostics.answer_enhancement).toMatchObject({
      called: true,
      applied: false,
      fallback: true,
      fallback_reason: "link_alignment_failed",
    });
  });

  it("normalizes recent chat history from the request context before calling rewriteQuery", async () => {
    mockFetchRecentVitals.mockResolvedValue({
      hadm_id: 101,
      keyword: "heart rate",
      records: [
        {
          label: "Heart Rate",
          valuenum: 98,
          valueuom: "bpm",
          charttime: "2025-01-01T08:05:00Z",
        },
      ],
    });

    const payload = parseAskRequest({
      hadm_id: 101,
      question: "Then?",
      context: {
        hadm_id: 101,
        last_question_type: null,
        chat_history: [
          {
            id: "discard-me",
            question: "",
            response: null,
            status: "completed",
            error: "",
          },
          {
            id: "t1",
            question: "q1",
            response: {
              success: true,
              question_type: "patient_info",
              answer: "a1",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t2",
            question: "q2",
            response: {
              success: true,
              question_type: "lab_query",
              answer: "a2",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t3",
            question: "q3",
            response: {
              success: true,
              question_type: "vital_query",
              answer: "a3",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t4",
            question: "q4",
            response: {
              success: true,
              question_type: "diagnosis_query",
              answer: "a4",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t5",
            question: "q5",
            response: {
              success: true,
              question_type: "patient_info",
              answer: "a5",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t6",
            question: "q6",
            response: {
              success: true,
              question_type: "lab_query",
              answer: "a6",
            },
            status: "completed",
            error: "",
          },
          {
            id: "t7",
            question: "q7",
            response: {
              success: true,
              question_type: "vital_query",
              answer: "a7",
            },
            status: "completed",
            error: "",
          },
        ],
      },
    });

    expect(payload).not.toBeNull();
    await runAskPipeline(payload!);

    expect(mockRewriteQuery).toHaveBeenCalledTimes(1);
    expect(mockRewriteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Then?",
        chat_history: expect.arrayContaining([
          expect.objectContaining({
            id: "t2",
            question: "q2",
            response: expect.objectContaining({
              answer: "a2",
              question_type: "lab_query",
            }),
          }),
          expect.objectContaining({
            id: "t7",
            question: "q7",
            response: expect.objectContaining({
              answer: "a7",
              question_type: "vital_query",
            }),
          }),
        ]),
      }),
    );

    const rewriteInput = mockRewriteQuery.mock.calls[0]?.[0] as {
      chat_history?: Array<{ id: string }>;
    };
    expect(rewriteInput.chat_history).toHaveLength(6);
    expect(rewriteInput.chat_history?.[0]?.id).toBe("t2");
  });
});
