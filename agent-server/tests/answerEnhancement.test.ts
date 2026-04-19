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

import { enhanceAnswer } from "../src/agent/enhancement/answerEnhancement";

describe("answerEnhancement", () => {
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

  it("applies a successful readability enhancement", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        enhanced_answer: "The latest Glucose result is 126 mg/dL.",
        changed: true,
        reason: "answer_enhancement_applied",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await enhanceAnswer({
      question: "latest glucose lab result",
      question_type: "lab_query",
      answer: "Latest Glucose result is 126 mg/dL.",
      evidence: [],
      tool_trace: [],
      answer_links: [],
      limitation: ["Structured answer only."],
    });

    expect(result).toMatchObject({
      enabled: true,
      called: true,
      changed: true,
      applied: true,
      fallback: false,
      enhanced_answer: "The latest Glucose result is 126 mg/dL.",
    });
  });

  it("falls back when numeric consistency validation fails", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        enhanced_answer: "The latest Glucose result is 128 mg/dL.",
        changed: true,
        reason: "answer_enhancement_applied",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await enhanceAnswer({
      question: "latest glucose lab result",
      question_type: "lab_query",
      answer: "Latest Glucose result is 126 mg/dL.",
      evidence: [],
      tool_trace: [],
      answer_links: [],
      limitation: ["Structured answer only."],
    });

    expect(result).toMatchObject({
      enabled: true,
      called: true,
      changed: false,
      applied: false,
      fallback: true,
      fallback_reason: "numeric_consistency_failed",
    });
    expect(result.enhanced_answer).toBe("Latest Glucose result is 126 mg/dL.");
  });

  it("falls back when answer links cannot be validated against evidence", async () => {
    mockGenerateLlmJson.mockResolvedValue({
      data: {
        enhanced_answer: "The latest Glucose result is 126 mg/dL.",
        changed: true,
        reason: "answer_enhancement_applied",
      },
      rawText: "{}",
      provider: "aliyun",
      model: "qwen-plus",
      attempt_count: 1,
    });

    const result = await enhanceAnswer({
      question: "latest glucose lab result",
      question_type: "lab_query",
      answer: "Latest Glucose result is 126 mg/dL.",
      evidence: [
        {
          type: "lab",
          title: "Glucose",
          content: {
            label: "Glucose",
            valuenum: 126,
            valueuom: "mg/dL",
            charttime: "2025-01-01T08:00:00Z",
          },
        },
      ],
      tool_trace: [],
      answer_links: [
        {
          id: "bad-link",
          text: "Glucose",
          start: 7,
          end: 14,
          evidence_type: "vital",
          evidence_index: 0,
          field: "label",
        },
      ],
      limitation: ["Structured answer only."],
    });

    expect(result).toMatchObject({
      enabled: true,
      called: true,
      changed: false,
      applied: false,
      fallback: true,
      fallback_reason: "link_evidence_validation_failed",
    });
    expect(result.enhanced_answer).toBe("Latest Glucose result is 126 mg/dL.");
  });

  it("falls back when the LLM is unavailable", async () => {
    mockGetLlmAvailability.mockReturnValue({
      enabled: false,
      provider: "aliyun",
      model: "qwen-plus",
      timeout_ms: 8000,
      retry_times: 1,
      reason: "LLM_API_KEY is not configured.",
    });

    const result = await enhanceAnswer({
      question: "latest glucose lab result",
      question_type: "lab_query",
      answer: "Latest Glucose result is 126 mg/dL.",
      evidence: [],
      tool_trace: [],
      answer_links: [],
      limitation: ["Structured answer only."],
    });

    expect(result).toMatchObject({
      enabled: true,
      called: false,
      changed: false,
      applied: false,
      fallback: true,
      fallback_reason: "LLM_API_KEY is not configured.",
    });
    expect(mockGenerateLlmJson).not.toHaveBeenCalled();
  });
});
