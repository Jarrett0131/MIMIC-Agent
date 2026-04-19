import { beforeEach, describe, expect, it } from "vitest";

import {
  resetRagCorpusCache,
  retrieveRagMatches,
} from "../src/agent/rag/retriever";

describe("retrieveRagMatches", () => {
  beforeEach(() => {
    resetRagCorpusCache();
  });

  it.each([
    "WBC 是什么意思？",
    "白细胞是什么意思？",
    "what does white blood cell mean?",
  ])("maps WBC aliases to the same knowledge family for '%s'", async (question) => {
    const result = await retrieveRagMatches({
      question,
      routeType: "metric_explanation",
      limit: 3,
    });

    expect(result.enabled).toBe(true);
    expect(result.retriever).toBe("hybrid");
    expect(result.items[0]).toMatchObject({
      title: "WBC",
      category: "metric",
      domain: "lab",
    });
    expect(result.items[0]?.matched_terms.length).toBeGreaterThan(0);
  });

  it.each([
    "glucose 代表什么？",
    "血糖指标代表什么？",
  ])("finds the lab explanation for glucose-like questions: '%s'", async (question) => {
    const result = await retrieveRagMatches({
      question,
      routeType: "metric_explanation",
      limit: 3,
    });

    expect(result.items[0]).toMatchObject({
      title: "Glucose",
      category: "metric",
      domain: "lab",
    });
  });

  it.each([
    {
      question: "charttime 是什么字段？",
      expectedTitle: "charttime",
    },
    {
      question: "hadm_id 是什么意思？",
      expectedTitle: "hadm_id",
    },
  ])("finds field explanations for $question", async ({ question, expectedTitle }) => {
    const result = await retrieveRagMatches({
      question,
      routeType: "field_explanation",
      limit: 3,
    });

    expect(result.items[0]).toMatchObject({
      title: expectedTitle,
      category: "field",
      domain: "patient",
    });
  });

  it("returns low/no recall for unrelated questions", async () => {
    const result = await retrieveRagMatches({
      question: "今天天气怎么样？",
      routeType: "knowledge_query",
      limit: 3,
    });

    expect(result.items).toEqual([]);
    expect(result.reason).toContain("No matching knowledge entries");
  });
});
