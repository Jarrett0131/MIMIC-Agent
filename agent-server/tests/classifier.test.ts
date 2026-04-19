import { describe, expect, it } from "vitest";

import { classifyQuestion } from "../src/services/classifier";

describe("classifyQuestion", () => {
  it.each([
    {
      input: "patient overview for this admission",
      expected: {
        routeType: "patient_info",
        displayType: "patient_info",
        routeFamily: "structured",
      },
    },
    {
      input: "latest glucose lab result",
      expected: {
        routeType: "lab_query",
        displayType: "lab_query",
        routeFamily: "structured",
      },
    },
    {
      input: "latest heart rate vital sign",
      expected: {
        routeType: "vital_query",
        displayType: "vital_query",
        routeFamily: "structured",
      },
    },
    {
      input: "WBC 是什么意思？",
      expected: {
        routeType: "metric_explanation",
        displayType: "lab_query",
        routeFamily: "rag",
      },
    },
    {
      input: "what does pulse measure?",
      expected: {
        routeType: "metric_explanation",
        displayType: "vital_query",
        routeFamily: "rag",
      },
    },
    {
      input: "what is sepsis?",
      expected: {
        routeType: "term_explanation",
        displayType: "diagnosis_query",
        routeFamily: "rag",
      },
    },
    {
      input: "charttime 是什么字段？",
      expected: {
        routeType: "field_explanation",
        displayType: "patient_info",
        routeFamily: "rag",
      },
    },
    {
      input: "这个术语是什么意思？",
      expected: {
        routeType: "knowledge_query",
        displayType: "patient_info",
        routeFamily: "rag",
      },
    },
    {
      input: "what is the weather today",
      expected: {
        routeType: "knowledge_query",
        displayType: "patient_info",
        routeFamily: "rag",
      },
    },
  ])("classifies '$input' correctly", ({ input, expected }) => {
    expect(classifyQuestion(input)).toEqual(expected);
  });
});
