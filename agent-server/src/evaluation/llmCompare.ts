import fs from "node:fs/promises";
import path from "node:path";

import type { Phase3EvalReport, Phase3EvalSampleResult } from "./types";

type LlmCompareOptions = {
  llmOnReportPath: string;
  llmOffReportPath: string;
  outputPath: string;
};

type MetricKey =
  | "route_accuracy"
  | "tool_accuracy"
  | "rag_top1_hit"
  | "rag_top3_hit"
  | "rewrite_trigger_rate"
  | "rewrite_expected_hit"
  | "rewrite_by_llm_rate"
  | "rewrite_by_fallback_rate"
  | "answer_success_rate"
  | "answer_enhancement_applied_rate"
  | "answer_enhancement_fallback_rate";

const METRICS_TO_COMPARE: MetricKey[] = [
  "route_accuracy",
  "tool_accuracy",
  "rag_top1_hit",
  "rag_top3_hit",
  "rewrite_trigger_rate",
  "rewrite_expected_hit",
  "rewrite_by_llm_rate",
  "rewrite_by_fallback_rate",
  "answer_success_rate",
  "answer_enhancement_applied_rate",
  "answer_enhancement_fallback_rate",
];

function roundDelta(value: number): number {
  return Number(value.toFixed(4));
}

function buildSampleMap(report: Phase3EvalReport): Map<string, Phase3EvalSampleResult> {
  return new Map(report.samples.map((sample) => [sample.id, sample]));
}

function formatRate(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return value.toFixed(4);
}

function describeAvailability(report: Phase3EvalReport): string {
  if (report.environment.llm_available) {
    return "available";
  }

  return `unavailable (${report.environment.llm_reason ?? "unknown reason"})`;
}

function summarizeAnswerEnhancement(
  llmOnReport: Phase3EvalReport,
  llmOffReport: Phase3EvalReport,
): string {
  if (!llmOnReport.environment.llm_available) {
    return `not exercised because LLM_ON had no available model (${llmOnReport.environment.llm_reason ?? "unknown reason"})`;
  }

  const appliedDelta = roundDelta(
    llmOnReport.metrics.answer_enhancement_applied_rate -
      llmOffReport.metrics.answer_enhancement_applied_rate,
  );
  const fallbackDelta = roundDelta(
    llmOnReport.metrics.answer_enhancement_fallback_rate -
      llmOffReport.metrics.answer_enhancement_fallback_rate,
  );

  if (appliedDelta >= 0 && fallbackDelta <= 0) {
    return `stable in this run (applied delta ${formatRate(appliedDelta)}, fallback delta ${formatRate(fallbackDelta)})`;
  }

  return `needs review (applied delta ${formatRate(appliedDelta)}, fallback delta ${formatRate(fallbackDelta)})`;
}

function buildImprovedFollowUps(
  llmOnReport: Phase3EvalReport,
  llmOffReport: Phase3EvalReport,
): Phase3EvalSampleResult[] {
  const llmOffById = buildSampleMap(llmOffReport);

  return llmOnReport.samples.filter((sample) => {
    if (sample.category !== "follow_up") {
      return false;
    }

    const baseline = llmOffById.get(sample.id);
    if (!baseline) {
      return false;
    }

    return (
      sample.rewrite_expected_hit === true &&
      baseline.rewrite_expected_hit !== true
    );
  });
}

function buildFallbackDependentSamples(report: Phase3EvalReport): Phase3EvalSampleResult[] {
  return report.samples.filter(
    (sample) =>
      (sample.category === "follow_up" && sample.rewrite_source === "fallback") ||
      (sample.answer_enhancement_called && sample.enhancement_fallback),
  );
}

function buildDegradedSamples(
  llmOnReport: Phase3EvalReport,
  llmOffReport: Phase3EvalReport,
): Array<{ id: string; question: string; reason: string }> {
  const llmOffById = buildSampleMap(llmOffReport);
  const degraded: Array<{ id: string; question: string; reason: string }> = [];

  llmOnReport.samples.forEach((sample) => {
    const baseline = llmOffById.get(sample.id);
    if (!baseline) {
      return;
    }

    if (baseline.route_hit && !sample.route_hit) {
      degraded.push({
        id: sample.id,
        question: sample.question,
        reason: "route_regressed",
      });
      return;
    }

    if (baseline.tool_hit && !sample.tool_hit) {
      degraded.push({
        id: sample.id,
        question: sample.question,
        reason: "tool_regressed",
      });
      return;
    }

    if (baseline.rewrite_expected_hit === true && sample.rewrite_expected_hit === false) {
      degraded.push({
        id: sample.id,
        question: sample.question,
        reason: "rewrite_regressed",
      });
    }
  });

  return degraded;
}

export function buildLlmCompareMarkdown(
  llmOnReport: Phase3EvalReport,
  llmOffReport: Phase3EvalReport,
): string {
  const improvedFollowUps = buildImprovedFollowUps(llmOnReport, llmOffReport);
  const fallbackDependentSamples = buildFallbackDependentSamples(llmOnReport);
  const degradedSamples = buildDegradedSamples(llmOnReport, llmOffReport);

  const lines = [
    "# LLM_ON vs LLM_OFF Compare Report",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- LLM_ON report: ${llmOnReport.dataset.path}`,
    `- LLM_OFF report: ${llmOffReport.dataset.path}`,
    `- LLM_ON availability: ${describeAvailability(llmOnReport)}`,
    `- LLM_OFF availability: ${describeAvailability(llmOffReport)}`,
    "",
    "## Metrics",
    "",
    "| Metric | LLM_OFF | LLM_ON | Delta |",
    "| --- | ---: | ---: | ---: |",
  ];

  METRICS_TO_COMPARE.forEach((metric) => {
    const offValue = llmOffReport.metrics[metric];
    const onValue = llmOnReport.metrics[metric];
    lines.push(
      `| ${metric} | ${formatRate(offValue)} | ${formatRate(onValue)} | ${formatRate(
        roundDelta(onValue - offValue),
      )} |`,
    );
  });

  lines.push("", "## Summary", "");
  lines.push(
    `- rewrite improvement: ${formatRate(roundDelta(llmOnReport.metrics.rewrite_expected_hit - llmOffReport.metrics.rewrite_expected_hit))}`,
  );
  lines.push(
    `- answer enhancement applied delta: ${formatRate(roundDelta(llmOnReport.metrics.answer_enhancement_applied_rate - llmOffReport.metrics.answer_enhancement_applied_rate))}`,
  );
  lines.push(
    `- answer enhancement fallback delta: ${formatRate(roundDelta(llmOnReport.metrics.answer_enhancement_fallback_rate - llmOffReport.metrics.answer_enhancement_fallback_rate))}`,
  );
  lines.push(
    `- answer enhancement stability: ${summarizeAnswerEnhancement(llmOnReport, llmOffReport)}`,
  );
  if (!llmOnReport.environment.llm_available) {
    lines.push(
      "- note: the current LLM_ON report still fell back to non-LLM behavior, so the compare output is not yet a true keyed-model benchmark.",
    );
  }

  lines.push("", "## Improved Follow-up Samples", "");
  if (improvedFollowUps.length === 0) {
    lines.push("- none");
  } else {
    improvedFollowUps.slice(0, 8).forEach((sample) => {
      lines.push(
        `- ${sample.id}: ${sample.question} | rewrite_source=${sample.rewrite_source} | rewritten=${sample.rewritten_question}`,
      );
    });
  }

  lines.push("", "## Fallback-dependent Samples", "");
  if (fallbackDependentSamples.length === 0) {
    lines.push("- none");
  } else {
    fallbackDependentSamples.slice(0, 8).forEach((sample) => {
      lines.push(
        `- ${sample.id}: rewrite_source=${sample.rewrite_source}, enhancement_fallback=${sample.enhancement_fallback}`,
      );
    });
  }

  lines.push("", "## Degraded Samples", "");
  if (degradedSamples.length === 0) {
    lines.push("- none");
  } else {
    degradedSamples.slice(0, 8).forEach((sample) => {
      lines.push(`- ${sample.id}: ${sample.question} | ${sample.reason}`);
    });
  }

  return `${lines.join("\n")}\n`;
}

export async function writeLlmCompareMarkdown(options: LlmCompareOptions): Promise<string> {
  const [llmOnRaw, llmOffRaw] = await Promise.all([
    fs.readFile(options.llmOnReportPath, "utf8"),
    fs.readFile(options.llmOffReportPath, "utf8"),
  ]);
  const llmOnReport = JSON.parse(llmOnRaw) as Phase3EvalReport;
  const llmOffReport = JSON.parse(llmOffRaw) as Phase3EvalReport;
  const markdown = buildLlmCompareMarkdown(llmOnReport, llmOffReport);

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, markdown, "utf8");

  return markdown;
}

function parseCliArgs(argv: string[]): LlmCompareOptions {
  let llmOnReportPath = "";
  let llmOffReportPath = "";
  let outputPath = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--llm-on-report" && next) {
      llmOnReportPath = next;
      index += 1;
      continue;
    }

    if (arg === "--llm-off-report" && next) {
      llmOffReportPath = next;
      index += 1;
      continue;
    }

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
    }
  }

  if (!llmOnReportPath || !llmOffReportPath || !outputPath) {
    throw new Error(
      "Missing required arguments. Use --llm-on-report <path> --llm-off-report <path> --output <path>.",
    );
  }

  return {
    llmOnReportPath,
    llmOffReportPath,
    outputPath,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  await writeLlmCompareMarkdown(options);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Failed to generate LLM compare report.";
    console.error(message);
    process.exitCode = 1;
  });
}
