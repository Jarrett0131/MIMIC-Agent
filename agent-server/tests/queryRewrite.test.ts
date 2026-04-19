import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateLlmJson,
  mockGetLlmAvailability,
} = vi.hoisted(() => ({
  mockGenerateLlmJson: vi.fn(),
  mockGetLlmAvailability: vi.fn(),
}));

vi.mock("../src/services/llmClient", () => ({
  generateLlmJson: mockGenerateLlmJson,
  getLlmAvailability: mockGetLlmAvailability,
  LlmClientError: class LlmClientError extends Error {},
}));

import { rewriteQuery } from "../src/agent/enhancement/queryRewrite";

describe("rewriteQuery", () => {
  beforeEach(() => {
    mockGenerateLlmJson.mockReset();
    mockGetLlmAvailability.mockReset();
    mockGetLlmAvailability.mockReturnValue({
      enabled: true,
      provider: "aliyun",
      model: "qwen-plus",
      timeout_ms: 8000,
      retry_times: 1,
    });
  });

  it("does not rewrite already clear questions", async () => {
    const result = await rewriteQuery({
      hadm_id: 101,
      question: "latest glucose lab result",
      last_question_type: null,
    });

    expect(result).toMatchObject({
      enabled: true,
      changed: false,
      source: "none",
      rewritten_question: "latest glucose lab result",
      reason: "question_already_clear",
    });
    expect(mockGenerateLlmJson).not.toHaveBeenCalled();
  });

  it("does not rewrite already clear Chinese explanation questions", async () => {
    const result = await rewriteQuery({
      hadm_id: 101,
      question: "\u8840\u7cd6\u6307\u6807\u4ee3\u8868\u4ec0\u4e48\uff1f",
      last_question_type: null,
    });

    expect(result).toMatchObject({
      changed: false,
      source: "none",
      rewritten_question: "\u8840\u7cd6\u6307\u6807\u4ee3\u8868\u4ec0\u4e48\uff1f",
      reason: "question_already_clear",
    });
    expect(mockGenerateLlmJson).not.toHaveBeenCalled();
  });

  it("prefers the LLM when rewrite succeeds", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        rewritten_question:
          "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
        changed: true,
        confidence: 0.92,
        reason: "follow_up_completion",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "\u90a3\u5fc3\u7387\u5462\uff1f",
      last_question_type: "lab_query",
    });

    expect(result).toMatchObject({
      enabled: true,
      changed: true,
      source: "llm",
      rewritten_question:
        "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
      reason: "follow_up_completion",
      guard_applied: false,
      guard_reason: "accepted",
    });
    expect(result.confidence).toBeCloseTo(0.92, 2);
    expect(mockGenerateLlmJson).toHaveBeenCalledTimes(1);
  });

  it("falls back to heuristic rewrite when the LLM fails", async () => {
    mockGenerateLlmJson.mockRejectedValue(new Error("mock llm failure"));

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "\u90a3\u8bca\u65ad\u5462\uff1f",
      last_question_type: "patient_info",
    });

    expect(result).toMatchObject({
      enabled: true,
      changed: true,
      source: "fallback",
      rewritten_question: "\u8fd9\u4e2a\u60a3\u8005\u7684\u8bca\u65ad\u7ed3\u679c\u662f\u4ec0\u4e48\uff1f",
      reason: "fallback_diagnosis",
      guard_applied: false,
    });
  });

  it("falls back when the LLM returns unchanged for an ambiguous follow-up", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        rewritten_question: "\u8fd9\u4e2a\u5b57\u6bb5\u5462\uff1f",
        changed: false,
        confidence: 0.4,
        reason: "model_considered_question_clear",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "\u8fd9\u4e2a\u5b57\u6bb5\u5462\uff1f",
      last_question_type: "patient_info",
    });

    expect(result).toMatchObject({
      enabled: true,
      changed: true,
      source: "fallback",
      rewritten_question: "\u8fd9\u4e2a\u5b57\u6bb5\u662f\u4ec0\u4e48\u610f\u601d\uff1f",
      reason: "fallback_field_explanation",
    });
    expect(mockGenerateLlmJson).toHaveBeenCalledTimes(1);
  });

  it("uses fallback rewrite when no key is available", async () => {
    mockGetLlmAvailability.mockReturnValue({
      enabled: false,
      provider: "aliyun",
      model: "qwen-plus",
      timeout_ms: 8000,
      retry_times: 1,
      reason: "LLM_API_KEY is not configured.",
    });

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "\u8fd9\u4e2a\u5b57\u6bb5\u5462\uff1f",
      last_question_type: "patient_info",
    });

    expect(result).toMatchObject({
      enabled: true,
      changed: true,
      source: "fallback",
      rewritten_question: "\u8fd9\u4e2a\u5b57\u6bb5\u662f\u4ec0\u4e48\u610f\u601d\uff1f",
      reason: "fallback_field_explanation",
    });
    expect(mockGenerateLlmJson).not.toHaveBeenCalled();
  });

  it("rejects patient-info rewrites that drift into another route and falls back safely", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        rewritten_question: "\u8fd9\u4e2a\u60a3\u8005\u7684\u8bca\u65ad\u4fe1\u606f\u662f\u4ec0\u4e48\uff1f",
        changed: true,
        confidence: 0.95,
        reason: "follow_up_completion",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "And patient info?",
      last_question_type: "diagnosis_query",
    });

    expect(result).toMatchObject({
      changed: true,
      source: "fallback",
      rewritten_question: "\u8fd9\u4e2a\u60a3\u8005\u7684\u57fa\u672c\u4fe1\u606f\u662f\u4ec0\u4e48\uff1f",
      reason: "fallback_patient_info",
      guard_applied: true,
      guard_reason: "protected_patient_info_keyword",
    });
  });

  it("drops very short high-risk rewrites back to the original question", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        rewritten_question: "What are the diagnoses for this patient?",
        changed: true,
        confidence: 0.88,
        reason: "follow_up_completion",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await rewriteQuery({
      hadm_id: 101,
      question: "Then?",
      last_question_type: null,
    });

    expect(result).toMatchObject({
      changed: false,
      source: "none",
      rewritten_question: "Then?",
      reason: "rewrite_guard_rejected",
      guard_applied: true,
      guard_reason: "short_question_large_change",
    });
  });

  it("passes recent chat history into the rewrite prompt and trims it to the latest turns", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        rewritten_question:
          "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
        changed: true,
        confidence: 0.88,
        reason: "history_follow_up_completion",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    await rewriteQuery({
      hadm_id: 101,
      question: "Then?",
      last_question_type: null,
      chat_history: [
        {
          id: "t1",
          question: "old question",
          response: {
            success: true,
            question_type: "patient_info",
            answer: "old answer",
          },
          status: "completed",
          error: "",
        },
        {
          id: "t2",
          question: "What is the latest glucose result?",
          response: {
            success: true,
            question_type: "lab_query",
            answer: "Latest Glucose result is 126 mg/dL.",
          },
          status: "completed",
          error: "",
        },
        {
          id: "t3",
          question: "And the heart rate?",
          response: {
            success: true,
            question_type: "vital_query",
            answer: "Latest Heart Rate result is 98 bpm.",
          },
          status: "completed",
          error: "",
        },
        {
          id: "t4",
          question: "What diagnoses are recorded?",
          response: {
            success: true,
            question_type: "diagnosis_query",
            answer: "The recorded diagnoses include sepsis.",
          },
          status: "completed",
          error: "",
        },
        {
          id: "t5",
          question: "What does WBC mean?",
          response: {
            success: true,
            question_type: "lab_query",
            answer: "WBC refers to white blood cell count.",
          },
          status: "completed",
          error: "",
        },
      ],
    });

    expect(mockGenerateLlmJson).toHaveBeenCalledTimes(1);
    const [, , schema] = mockGenerateLlmJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
      Record<string, unknown>,
      { name: string; description: string },
    ];
    const [messages] = mockGenerateLlmJson.mock.calls[0] as [
      Array<{ role: string; content: string }>,
      Record<string, unknown>,
      { name: string; description: string },
    ];
    const requestPayload = JSON.parse(messages[1]?.content ?? "{}") as {
      recent_chat_history?: string;
    };

    expect(requestPayload.recent_chat_history).toContain("And the heart rate?");
    expect(requestPayload.recent_chat_history).toContain("Latest Heart Rate result is 98 bpm.");
    expect(requestPayload.recent_chat_history).toContain("What does WBC mean?");
    expect(requestPayload.recent_chat_history).not.toContain("old question");
    expect(schema.name).toBe("query_rewrite_payload");
  });
});
