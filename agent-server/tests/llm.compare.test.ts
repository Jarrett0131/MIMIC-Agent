import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeLlmCompareMarkdown } from "../src/evaluation/llmCompare";

describe("llm compare report", () => {
  it("writes an LLM_ON vs LLM_OFF compare markdown report", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-compare-"));
    const llmOnReportPath = path.join(tempRoot, "llm_on.json");
    const llmOffReportPath = path.join(tempRoot, "llm_off.json");
    const outputPath = path.join(tempRoot, "compare.md");

    const baseReport = {
      generated_at: new Date().toISOString(),
      mode: "offline",
      dataset: {
        path: "dataset.json",
        version: "phase3.test",
        sample_count: 1,
        counts_by_category: {
          structured: 0,
          rag: 0,
          follow_up: 1,
        },
      },
      environment: {
        llm_available: false,
      },
      metric_details: {} as Record<string, unknown>,
      experiment: {
        enabled: false,
        improved_samples: [],
        degraded_samples: [],
        unchanged_samples: 0,
      },
    };

    await fs.writeFile(
      llmOffReportPath,
      JSON.stringify(
        {
          ...baseReport,
          metrics: {
            route_accuracy: 0.9,
            tool_accuracy: 0.9,
            rag_top1_hit: 0.9,
            rag_top3_hit: 0.9,
            rewrite_trigger_rate: 0.1,
            rewrite_expected_hit: 0.2,
            rewrite_by_llm_rate: 0,
            rewrite_by_fallback_rate: 0.1,
            answer_success_rate: 1,
            evidence_presence_rate: 1,
            answer_enhancement_applied_rate: 0,
            answer_enhancement_fallback_rate: 1,
          },
          samples: [
            {
              id: "followup_1",
              category: "follow_up",
              question: "\u90a3\u5fc3\u7387\u5462\uff1f",
              hadm_id: 1,
              expected_route: "vital_query",
              predicted_question_type: "lab_query",
              expected_tool: "fetchRecentVitals",
              predicted_tool: "fetchRecentLabs",
              route_hit: false,
              tool_hit: false,
              original_question: "\u90a3\u5fc3\u7387\u5462\uff1f",
              rewritten_question: "\u90a3\u5fc3\u7387\u5462\uff1f",
              rewrite_changed: false,
              rewrite_source: "none",
              answer_success: true,
              answer_non_empty: true,
              evidence_non_empty: true,
              answer_enhancement_called: false,
              answer_enhancement_applied: false,
              enhancement_fallback: true,
              top3_titles: [],
              tool_trace: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.writeFile(
      llmOnReportPath,
      JSON.stringify(
        {
          ...baseReport,
          environment: {
            llm_available: true,
          },
          metrics: {
            route_accuracy: 1,
            tool_accuracy: 1,
            rag_top1_hit: 0.9,
            rag_top3_hit: 0.9,
            rewrite_trigger_rate: 0.8,
            rewrite_expected_hit: 0.9,
            rewrite_by_llm_rate: 0.8,
            rewrite_by_fallback_rate: 0,
            answer_success_rate: 1,
            evidence_presence_rate: 1,
            answer_enhancement_applied_rate: 0.8,
            answer_enhancement_fallback_rate: 0.2,
          },
          samples: [
            {
              id: "followup_1",
              category: "follow_up",
              question: "\u90a3\u5fc3\u7387\u5462\uff1f",
              hadm_id: 1,
              expected_route: "vital_query",
              predicted_question_type: "vital_query",
              expected_tool: "fetchRecentVitals",
              predicted_tool: "fetchRecentVitals",
              route_hit: true,
              tool_hit: true,
              original_question: "\u90a3\u5fc3\u7387\u5462\uff1f",
              rewritten_question:
                "\u8fd9\u4e2a\u60a3\u8005\u6700\u8fd1\u7684\u5fc3\u7387\u60c5\u51b5\u5982\u4f55\uff1f",
              rewrite_changed: true,
              rewrite_source: "llm",
              rewrite_expected_hit: true,
              answer_success: true,
              answer_non_empty: true,
              evidence_non_empty: true,
              answer_enhancement_called: true,
              answer_enhancement_applied: true,
              enhancement_fallback: false,
              top3_titles: [],
              tool_trace: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLlmCompareMarkdown({
      llmOnReportPath,
      llmOffReportPath,
      outputPath,
    });

    const markdown = await fs.readFile(outputPath, "utf8");
    expect(markdown).toContain("LLM_ON vs LLM_OFF Compare Report");
    expect(markdown).toContain("LLM_ON availability: available");
    expect(markdown).toContain("rewrite_expected_hit");
    expect(markdown).toContain("answer enhancement stability: stable");
    expect(markdown).toContain("followup_1");
  });

  it("flags when the LLM_ON report still has no available model", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-compare-unavailable-"));
    const llmOnReportPath = path.join(tempRoot, "llm_on.json");
    const llmOffReportPath = path.join(tempRoot, "llm_off.json");
    const outputPath = path.join(tempRoot, "compare.md");

    const baseReport = {
      generated_at: new Date().toISOString(),
      mode: "offline",
      dataset: {
        path: "dataset.json",
        version: "phase3.test",
        sample_count: 1,
        counts_by_category: {
          structured: 0,
          rag: 0,
          follow_up: 1,
        },
      },
      metrics: {
        route_accuracy: 1,
        tool_accuracy: 1,
        rag_top1_hit: 0,
        rag_top3_hit: 0,
        rewrite_trigger_rate: 0,
        rewrite_expected_hit: 0,
        rewrite_by_llm_rate: 0,
        rewrite_by_fallback_rate: 0,
        answer_success_rate: 1,
        evidence_presence_rate: 1,
        answer_enhancement_applied_rate: 0,
        answer_enhancement_fallback_rate: 1,
      },
      metric_details: {} as Record<string, unknown>,
      samples: [],
      experiment: {
        enabled: false,
        improved_samples: [],
        degraded_samples: [],
        unchanged_samples: 0,
      },
    };

    await fs.writeFile(
      llmOffReportPath,
      JSON.stringify(
        {
          ...baseReport,
          environment: {
            llm_available: false,
            llm_reason: "LLM is disabled by configuration.",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.writeFile(
      llmOnReportPath,
      JSON.stringify(
        {
          ...baseReport,
          environment: {
            llm_available: false,
            llm_reason: "LLM_API_KEY is not configured.",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeLlmCompareMarkdown({
      llmOnReportPath,
      llmOffReportPath,
      outputPath,
    });

    const markdown = await fs.readFile(outputPath, "utf8");
    expect(markdown).toContain("LLM_ON availability: unavailable (LLM_API_KEY is not configured.)");
    expect(markdown).toContain("not exercised because LLM_ON had no available model");
    expect(markdown).toContain("not yet a true keyed-model benchmark");
  });
});
