import { describe, expect, it } from "vitest";

import { generateAnswer } from "../src/services/generator";

describe("generator", () => {
  it("returns a single RAG miss message from generator when no knowledge item matches", async () => {
    const result = await generateAnswer(
      "knowledge_query",
      "patient_info",
      {
        enabled: true,
        question: "unknown term",
        route_type: "knowledge_query",
        retriever: "lexical",
        answer_draft: undefined,
        items: [],
        reason: "No exact medical term match was found.",
      },
      ["classifying", "tool_running"],
      [],
      "unknown term",
    );

    expect(result.response.answer).toContain("本地知识库中没有找到直接匹配的解释。");
    expect(result.response.answer).toContain("No exact medical term match was found.");
    expect(result.response.evidence).toHaveLength(0);
  });

  it("adds rag enhancement text and evidence to structured answers when supplemental knowledge exists", async () => {
    const result = await generateAnswer(
      "lab_query",
      "lab_query",
      {
        records: {
          records: [
            {
              label: "Glucose",
              valuenum: 126,
              valueuom: "mg/dL",
              charttime: "2025-01-01T08:00:00Z",
            },
          ],
        },
        rag_enhancement: {
          answer_draft: "Glucose 通常用于反映血糖水平。",
          items: [
            {
              title: "Glucose",
              chunk: "反映血糖水平。",
              source: "docs/rag/lab_item_explanations.json",
              score: 0.91,
              category: "metric",
              domain: "lab",
            },
          ],
        },
      },
      ["classifying", "tool_running"],
      [],
      "latest glucose",
    );

    expect(result.response.answer).toContain("最新");
    expect(result.response.answer).toContain("补充解释");
    expect(result.response.answer).toContain("Glucose 通常用于反映血糖水平。");
    expect(result.response.evidence.some((item) => item.type === "text")).toBe(true);
    expect(result.response.limitation.some((item) => item.includes("知识库"))).toBe(true);
  });
});
