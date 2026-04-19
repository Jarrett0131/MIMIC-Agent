import fs from "node:fs/promises";
import path from "node:path";

import type { RagExperimentOverrides } from "../agent/rag/embeddingTypes";
import { retrieveRagMatches } from "../agent/rag/retriever";
import { getLlmAvailability } from "../services/llmClient";
import { parseAskRequest, runAskPipeline } from "../services/askPipeline";
import type { AskResponse, KnowledgeQuestionType } from "../types";
import { EvalDatasetError, getRepoPath, loadPhase3EvalDataset } from "./evalDataset";
import type {
  Phase3EvalExperimentReport,
  Phase3EvalMetricDetail,
  Phase3EvalMetricDetails,
  Phase3EvalMetrics,
  Phase3EvalReport,
  Phase3EvalSample,
  Phase3EvalSampleResult,
} from "./types";

type EvalMode = "offline" | "live" | "auto";

type RunPhase3EvaluationOptions = {
  mode?: EvalMode;
  datasetPath?: string;
  reportPath?: string;
  markdownReportPath?: string;
  agentServerUrl?: string;
  runExperimentComparison?: boolean;
  experiment?: RagExperimentOverrides;
  quiet?: boolean;
};

const DEFAULT_AGENT_SERVER_URL = "http://127.0.0.1:3001";

export class Phase3EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase3EvalError";
  }
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function roundRate(hit: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Number((hit / total).toFixed(4));
}

function buildMetricDetail(hit: number, total: number): Phase3EvalMetricDetail {
  return {
    hit,
    total,
    rate: roundRate(hit, total),
  };
}

function buildMetrics(details: Phase3EvalMetricDetails): Phase3EvalMetrics {
  return {
    route_accuracy: details.route_accuracy.rate,
    tool_accuracy: details.tool_accuracy.rate,
    rag_top1_hit: details.rag_top1_hit.rate,
    rag_top3_hit: details.rag_top3_hit.rate,
    rag_miss_rate: details.rag_miss_rate.rate,
    rag_enhancement_used_rate: details.rag_enhancement_used_rate.rate,
    rewrite_trigger_rate: details.rewrite_trigger_rate.rate,
    rewrite_expected_hit: details.rewrite_expected_hit.rate,
    rewrite_by_llm_rate: details.rewrite_by_llm_rate.rate,
    rewrite_by_fallback_rate: details.rewrite_by_fallback_rate.rate,
    answer_success_rate: details.answer_success_rate.rate,
    evidence_presence_rate: details.evidence_presence_rate.rate,
    answer_enhancement_applied_rate: details.answer_enhancement_applied_rate.rate,
    answer_enhancement_fallback_rate: details.answer_enhancement_fallback_rate.rate,
    llm_call_rate: details.llm_call_rate.rate,
    llm_streaming_rate: details.llm_streaming_rate.rate,
    llm_fallback_rate: details.llm_fallback_rate.rate,
  };
}

function matchesAnyExpectedTitle(expectedTitles: string[], titles: string[]): boolean {
  const normalizedExpected = expectedTitles.map((title) => normalizeText(title));
  return titles.some((title) => normalizedExpected.includes(normalizeText(title)));
}

function computeKeywordCoverage(expectedKeywords: string[] | undefined, content: string): number | undefined {
  if (!expectedKeywords || expectedKeywords.length === 0) {
    return undefined;
  }

  const normalizedContent = normalizeText(content);
  const hit = expectedKeywords.filter((keyword) =>
    normalizedContent.includes(normalizeText(keyword)),
  ).length;

  return roundRate(hit, expectedKeywords.length);
}

function isKnowledgeRoute(value: string): value is KnowledgeQuestionType {
  return (
    value === "term_explanation" ||
    value === "metric_explanation" ||
    value === "field_explanation" ||
    value === "knowledge_query"
  );
}

function buildKeywordSourceFromResponse(response: AskResponse): string {
  const evidenceText = response.evidence
    .map((item) => {
      const content =
        typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? {});
      return `${item.title} ${content}`;
    })
    .join(" ");

  return `${response.answer} ${evidenceText}`.trim();
}

function buildSampleResult(
  sample: Phase3EvalSample,
  response: AskResponse,
  meta: {
    rewrittenQuestion: string;
    rewriteChanged: boolean;
    rewriteSource: "llm" | "fallback" | "none";
    rewriteConfidence?: number;
    predictedRoute: string | null;
    predictedTool: string | null;
    topTitles: string[];
    keywordSource: string;
    answerEnhancementCalled: boolean;
    answerEnhancementApplied: boolean;
    answerEnhancementFallback: boolean;
    llmCallCount: number;
    llmStreamed: boolean;
    llmFallbackUsed: boolean;
    ragMiss: boolean;
    ragEnhancementUsed: boolean;
  },
): Phase3EvalSampleResult {
  const top1Title = meta.topTitles[0];
  const ragTop1Hit =
    sample.category === "rag" && sample.expected_titles && top1Title
      ? matchesAnyExpectedTitle(sample.expected_titles, [top1Title])
      : undefined;
  const ragTop3Hit =
    sample.category === "rag" && sample.expected_titles
      ? matchesAnyExpectedTitle(sample.expected_titles, meta.topTitles)
      : undefined;

  let rewriteExpectedHit: boolean | undefined;
  if (sample.expected_rewrite) {
    const rewrittenNormalized = normalizeText(meta.rewrittenQuestion);
    const originalNormalized = normalizeText(sample.question);
    const actualTrigger = rewrittenNormalized !== originalNormalized;
    const containsHit =
      !sample.expected_rewrite.rewritten_contains ||
      sample.expected_rewrite.rewritten_contains.every((value) =>
        rewrittenNormalized.includes(normalizeText(value)),
      );
    const changedHit =
      sample.expected_rewrite.changed === undefined ||
      sample.expected_rewrite.changed === meta.rewriteChanged;

    rewriteExpectedHit = sample.expected_rewrite.trigger === actualTrigger && changedHit && containsHit;
  }

  return {
    id: sample.id,
    category: sample.category,
    question: sample.question,
    hadm_id: sample.hadm_id,
    expected_route: sample.expected_route,
    predicted_question_type: meta.predictedRoute as Phase3EvalSampleResult["predicted_question_type"],
    expected_tool: sample.expected_tool,
    predicted_tool: meta.predictedTool,
    route_hit: meta.predictedRoute === sample.expected_route,
      tool_hit: meta.predictedTool === sample.expected_tool,
      original_question: sample.question,
      rewritten_question: meta.rewrittenQuestion,
      rewrite_changed: meta.rewriteChanged,
      rewrite_source: meta.rewriteSource,
      rewrite_confidence: meta.rewriteConfidence,
      rewrite_expected_hit: rewriteExpectedHit,
      answer_success: response.success,
      answer_non_empty: response.answer.trim().length > 0,
      evidence_non_empty: response.evidence.length > 0,
      answer_enhancement_called: meta.answerEnhancementCalled,
      answer_enhancement_applied: meta.answerEnhancementApplied,
      enhancement_fallback: meta.answerEnhancementFallback,
      llm_call_count: meta.llmCallCount,
      llm_streamed: meta.llmStreamed,
      llm_fallback_used: meta.llmFallbackUsed,
      rag_miss: meta.ragMiss,
      rag_enhancement_used: meta.ragEnhancementUsed,
      top1_title: top1Title,
      top3_titles: meta.topTitles,
      rag_top1_hit: ragTop1Hit,
    rag_top3_hit: ragTop3Hit,
    keyword_coverage: computeKeywordCoverage(sample.expected_keywords, meta.keywordSource),
    tool_trace: response.tool_trace,
    error_code: response.error?.code ?? undefined,
    notes: sample.notes,
  };
}

function buildFailureSampleResult(
  sample: Phase3EvalSample,
  error: unknown,
): Phase3EvalSampleResult {
  const message =
    error instanceof Error && error.message.trim() ? error.message : "Evaluation request failed.";

  return {
    id: sample.id,
    category: sample.category,
    question: sample.question,
    hadm_id: sample.hadm_id,
    expected_route: sample.expected_route,
    predicted_question_type: null,
    expected_tool: sample.expected_tool,
    predicted_tool: null,
    route_hit: false,
    tool_hit: false,
    original_question: sample.question,
    rewritten_question: sample.question,
    rewrite_changed: false,
    rewrite_source: "none",
    answer_success: false,
    answer_non_empty: false,
    evidence_non_empty: false,
    answer_enhancement_called: false,
    answer_enhancement_applied: false,
    enhancement_fallback: false,
    llm_call_count: 0,
    llm_streamed: false,
    llm_fallback_used: false,
    rag_miss: false,
    rag_enhancement_used: false,
    top3_titles: [],
    tool_trace: [],
    error_code: "EVAL_EXECUTION_FAILED",
    notes: `${sample.notes ?? ""}${sample.notes ? " | " : ""}${message}`,
  };
}

async function callOffline(sample: Phase3EvalSample): Promise<Phase3EvalSampleResult> {
  const payload = parseAskRequest({
    hadm_id: sample.hadm_id,
    question: sample.question,
    context: sample.context ?? {
      hadm_id: sample.hadm_id,
      last_question_type: null,
    },
  });

  if (!payload) {
    throw new Phase3EvalError(`Failed to build ask payload for sample ${sample.id}.`);
  }

  const result = await runAskPipeline(payload);
  const topTitles = result.diagnostics.rag?.top_results.map((item) => item.title) ?? [];
  const response = result.response;

  return buildSampleResult(sample, response, {
    rewrittenQuestion:
      result.diagnostics.rewrite.rewritten_question ||
      response.enhancement?.query_rewrite?.rewritten_question ||
      sample.question,
    rewriteChanged:
      result.diagnostics.rewrite.changed ||
      response.enhancement?.query_rewrite?.changed === true,
    rewriteSource:
      response.enhancement?.query_rewrite?.source ??
      result.diagnostics.rewrite.source ??
      "none",
    rewriteConfidence:
      response.enhancement?.query_rewrite?.confidence ??
      result.diagnostics.rewrite.confidence,
    predictedRoute:
      result.diagnostics.classification?.route_type ?? response.routing?.route_type ?? null,
    predictedTool:
      result.diagnostics.routed_tool ?? response.tool_trace[0]?.tool ?? null,
    topTitles,
    answerEnhancementCalled:
      response.enhancement?.answer_enhancement?.called ??
      result.diagnostics.answer_enhancement?.called ??
      false,
    answerEnhancementApplied:
      response.enhancement?.answer_enhancement?.applied ??
      result.diagnostics.answer_enhancement?.applied ??
      false,
    answerEnhancementFallback:
      response.enhancement?.answer_enhancement?.fallback ??
      result.diagnostics.answer_enhancement?.fallback ??
      false,
    llmCallCount: result.diagnostics.llm?.call_count ?? 0,
    llmStreamed: result.diagnostics.llm?.streamed ?? false,
    llmFallbackUsed: result.diagnostics.llm?.fallback_used ?? false,
    ragMiss:
      response.routing?.route_family === "rag" &&
      result.diagnostics.rag?.used === true &&
      result.diagnostics.rag?.matched === false,
    ragEnhancementUsed:
      response.routing?.route_family === "structured" &&
      response.evidence.some((item) => item.type === "text"),
    keywordSource:
      [
        response.answer,
        ...(result.diagnostics.rag?.top_results.map((item) => item.title) ?? []),
        ...(result.diagnostics.rag?.top_results.flatMap((item) => item.matched_terms) ?? []),
      ].join(" "),
  });
}

async function callLive(
  sample: Phase3EvalSample,
  agentServerUrl: string,
): Promise<Phase3EvalSampleResult> {
  const response = await fetch(`${agentServerUrl.replace(/\/+$/, "")}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      hadm_id: sample.hadm_id,
      question: sample.question,
      context: sample.context ?? {
        hadm_id: sample.hadm_id,
        last_question_type: null,
      },
    }),
  });

  const payload = (await response.json()) as AskResponse;
  const topTitles = payload.evidence
    .filter((item) => ["text", "knowledge"].includes(item.type as string))
    .map((item) => item.title)
    .slice(0, 3);

  return buildSampleResult(sample, payload, {
    rewrittenQuestion:
      payload.enhancement?.query_rewrite?.rewritten_question ?? sample.question,
    rewriteChanged: payload.enhancement?.query_rewrite?.changed === true,
    rewriteSource: payload.enhancement?.query_rewrite?.source ?? "none",
    rewriteConfidence: payload.enhancement?.query_rewrite?.confidence,
    predictedRoute: payload.routing?.route_type ?? payload.question_type ?? null,
    predictedTool: payload.tool_trace[0]?.tool ?? null,
    topTitles,
    answerEnhancementCalled: payload.enhancement?.answer_enhancement?.called === true,
    answerEnhancementApplied: payload.enhancement?.answer_enhancement?.applied === true,
    answerEnhancementFallback: payload.enhancement?.answer_enhancement?.fallback === true,
    llmCallCount: payload.diagnostics?.llm?.call_count ?? 0,
    llmStreamed: payload.diagnostics?.llm?.streamed ?? false,
    llmFallbackUsed: payload.diagnostics?.llm?.fallback_used ?? false,
    ragMiss:
      payload.routing?.route_family === "rag" &&
      payload.diagnostics?.rag?.used === true &&
      payload.diagnostics?.rag?.matched === false,
    ragEnhancementUsed:
      payload.routing?.route_family === "structured" &&
      payload.evidence.some((item) => item.type === "text"),
    keywordSource: buildKeywordSourceFromResponse(payload),
  });
}

function buildMetricDetails(results: Phase3EvalSampleResult[], samples: Phase3EvalSample[]): Phase3EvalMetricDetails {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
  const ragResults = results.filter((result) => result.category === "rag");
  const followUpResults = results.filter((result) => result.category === "follow_up");
  const evidenceRequiredResults = results.filter((result) => sampleById.get(result.id)?.requires_evidence);

  return {
    route_accuracy: buildMetricDetail(
      results.filter((result) => result.route_hit).length,
      results.length,
    ),
    tool_accuracy: buildMetricDetail(
      results.filter((result) => result.tool_hit).length,
      results.length,
    ),
    rag_top1_hit: buildMetricDetail(
      ragResults.filter((result) => result.rag_top1_hit === true).length,
      ragResults.length,
    ),
    rag_top3_hit: buildMetricDetail(
      ragResults.filter((result) => result.rag_top3_hit === true).length,
      ragResults.length,
    ),
    rag_miss_rate: buildMetricDetail(
      ragResults.filter((result) => result.rag_miss).length,
      ragResults.length,
    ),
    rag_enhancement_used_rate: buildMetricDetail(
      results.filter((result) => result.rag_enhancement_used).length,
      results.length,
    ),
    rewrite_trigger_rate: buildMetricDetail(
      followUpResults.filter((result) => result.rewrite_changed).length,
      followUpResults.length,
    ),
    rewrite_expected_hit: buildMetricDetail(
      followUpResults.filter((result) => result.rewrite_expected_hit === true).length,
      followUpResults.filter((result) => result.rewrite_expected_hit !== undefined).length,
    ),
    rewrite_by_llm_rate: buildMetricDetail(
      followUpResults.filter(
        (result) => result.rewrite_changed && result.rewrite_source === "llm",
      ).length,
      followUpResults.length,
    ),
    rewrite_by_fallback_rate: buildMetricDetail(
      followUpResults.filter(
        (result) => result.rewrite_changed && result.rewrite_source === "fallback",
      ).length,
      followUpResults.length,
    ),
    answer_success_rate: buildMetricDetail(
      results.filter((result) => result.answer_success).length,
      results.length,
    ),
    evidence_presence_rate: buildMetricDetail(
      evidenceRequiredResults.filter((result) => result.evidence_non_empty).length,
      evidenceRequiredResults.length,
    ),
    answer_enhancement_applied_rate: buildMetricDetail(
      results.filter((result) => result.answer_enhancement_applied).length,
      results.length,
    ),
    answer_enhancement_fallback_rate: buildMetricDetail(
      results.filter((result) => result.enhancement_fallback).length,
      results.length,
    ),
    llm_call_rate: buildMetricDetail(
      results.filter((result) => result.llm_call_count > 0).length,
      results.length,
    ),
    llm_streaming_rate: buildMetricDetail(
      results.filter((result) => result.llm_streamed).length,
      results.length,
    ),
    llm_fallback_rate: buildMetricDetail(
      results.filter((result) => result.llm_fallback_used).length,
      results.length,
    ),
  };
}

function getDefaultExperimentConfig(): RagExperimentOverrides {
  return {
    rerankEnabled: true,
    embeddingCacheEnabled: true,
    embeddingProvider: "local",
    embeddingModel: "token-hash-v1",
    embeddingCachePath: getRepoPath("evaluation", "cache", "rag_embeddings.json"),
    embeddingDimensions: 96,
    candidateLimit: 8,
  };
}

async function runExperimentComparison(
  samples: Phase3EvalSample[],
  baselineResults: Phase3EvalSampleResult[],
  options: RunPhase3EvaluationOptions,
): Promise<Phase3EvalExperimentReport> {
  if (options.runExperimentComparison === false) {
    return {
      enabled: false,
      improved_samples: [],
      degraded_samples: [],
      unchanged_samples: 0,
      skipped_reason: "Experiment comparison is disabled by option.",
    };
  }

  const experimentConfig = options.experiment ?? getDefaultExperimentConfig();
  const ragSamples = samples.filter(
    (sample) => sample.category === "rag" && isKnowledgeRoute(sample.expected_route),
  );

  if (ragSamples.length === 0) {
    return {
      enabled: false,
      improved_samples: [],
      degraded_samples: [],
      unchanged_samples: 0,
      skipped_reason: "No standalone rag samples are available for comparison.",
    };
  }

  const baselineById = new Map(baselineResults.map((result) => [result.id, result]));
  const improved: Phase3EvalExperimentReport["improved_samples"] = [];
  const degraded: Phase3EvalExperimentReport["degraded_samples"] = [];
  let unchanged = 0;
  let top1Hit = 0;
  let top3Hit = 0;
  let firstSkippedReason: string | undefined;

  for (const sample of ragSamples) {
    const baseline = baselineById.get(sample.id);
    if (!baseline) {
      continue;
    }

    const retrieval = await retrieveRagMatches({
      question: sample.question,
      routeType: sample.expected_route as KnowledgeQuestionType,
      limit: 3,
      experiment: experimentConfig,
    });

    const experimentTitles = retrieval.items.map((item) => item.title);
    const experimentTop1Hit = matchesAnyExpectedTitle(
      sample.expected_titles ?? [],
      experimentTitles.slice(0, 1),
    );
    const experimentTop3Hit = matchesAnyExpectedTitle(
      sample.expected_titles ?? [],
      experimentTitles,
    );

    if (retrieval.experiment?.applied === false && !firstSkippedReason) {
      firstSkippedReason = retrieval.experiment.reason;
    }

    if (experimentTop1Hit) {
      top1Hit += 1;
    }

    if (experimentTop3Hit) {
      top3Hit += 1;
    }

    const improvedHit =
      (!baseline.rag_top1_hit && experimentTop1Hit) ||
      (!baseline.rag_top3_hit && experimentTop3Hit);
    const degradedHit =
      (baseline.rag_top1_hit && !experimentTop1Hit) ||
      (baseline.rag_top3_hit && !experimentTop3Hit);

    if (improvedHit) {
      improved.push({
        id: sample.id,
        question: sample.question,
        expected_titles: sample.expected_titles ?? [],
        baseline_top3_titles: baseline.top3_titles,
        experiment_top3_titles: experimentTitles,
      });
      continue;
    }

    if (degradedHit) {
      degraded.push({
        id: sample.id,
        question: sample.question,
        expected_titles: sample.expected_titles ?? [],
        baseline_top3_titles: baseline.top3_titles,
        experiment_top3_titles: experimentTitles,
      });
      continue;
    }

    unchanged += 1;
  }

  const metricDetails = {
    rag_top1_hit: buildMetricDetail(top1Hit, ragSamples.length),
    rag_top3_hit: buildMetricDetail(top3Hit, ragSamples.length),
  };
  const baselineMetricDetails = buildMetricDetails(
    baselineResults.filter((result) => result.category === "rag"),
    samples.filter((sample) => sample.category === "rag"),
  );

  return {
    enabled: true,
    config: experimentConfig,
    metrics: {
      rag_top1_hit: metricDetails.rag_top1_hit.rate,
      rag_top3_hit: metricDetails.rag_top3_hit.rate,
    },
    metric_details: metricDetails,
    delta: {
      rag_top1_hit: Number(
        (metricDetails.rag_top1_hit.rate - baselineMetricDetails.rag_top1_hit.rate).toFixed(4),
      ),
      rag_top3_hit: Number(
        (metricDetails.rag_top3_hit.rate - baselineMetricDetails.rag_top3_hit.rate).toFixed(4),
      ),
    },
    improved_samples: improved.slice(0, 5),
    degraded_samples: degraded.slice(0, 5),
    unchanged_samples: unchanged,
    skipped_reason:
      improved.length === 0 && degraded.length === 0 && firstSkippedReason
        ? firstSkippedReason
        : undefined,
  };
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function buildMarkdownReport(report: Phase3EvalReport): string {
  const lines = [
    "# Phase 3 Evaluation Report",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Mode: ${report.mode}`,
    `- Dataset: ${report.dataset.path}`,
    `- Sample count: ${report.dataset.sample_count}`,
    "",
    "## Metrics",
    "",
    "| Metric | Hit | Total | Rate |",
    "| --- | ---: | ---: | ---: |",
  ];

  for (const [key, detail] of Object.entries(report.metric_details)) {
    lines.push(`| ${key} | ${detail.hit} | ${detail.total} | ${detail.rate} |`);
  }

  lines.push("", "## Experiment", "");
  if (!report.experiment.enabled) {
    lines.push(`- Skipped: ${report.experiment.skipped_reason ?? "not enabled"}`);
  } else {
    lines.push(
      `- rag_top1_hit delta: ${report.experiment.delta?.rag_top1_hit ?? 0}`,
      `- rag_top3_hit delta: ${report.experiment.delta?.rag_top3_hit ?? 0}`,
      `- Improved samples: ${report.experiment.improved_samples.length}`,
      `- Degraded samples: ${report.experiment.degraded_samples.length}`,
      `- Unchanged samples: ${report.experiment.unchanged_samples}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function logSummary(report: Phase3EvalReport): void {
  console.log("Phase 3 evaluation summary");
  console.log(`mode=${report.mode} samples=${report.dataset.sample_count}`);
  console.log(
    `route_accuracy=${report.metrics.route_accuracy} tool_accuracy=${report.metrics.tool_accuracy}`,
  );
  console.log(
    `rag_top1_hit=${report.metrics.rag_top1_hit} rag_top3_hit=${report.metrics.rag_top3_hit}`,
  );
  console.log(
    `rewrite_trigger_rate=${report.metrics.rewrite_trigger_rate} rewrite_expected_hit=${report.metrics.rewrite_expected_hit}`,
  );
  console.log(
    `rewrite_by_llm_rate=${report.metrics.rewrite_by_llm_rate} rewrite_by_fallback_rate=${report.metrics.rewrite_by_fallback_rate}`,
  );
  console.log(
    `answer_success_rate=${report.metrics.answer_success_rate} evidence_presence_rate=${report.metrics.evidence_presence_rate}`,
  );
  console.log(
    `answer_enhancement_applied_rate=${report.metrics.answer_enhancement_applied_rate} answer_enhancement_fallback_rate=${report.metrics.answer_enhancement_fallback_rate}`,
  );
  console.log(
    `rag_miss_rate=${report.metrics.rag_miss_rate} rag_enhancement_used_rate=${report.metrics.rag_enhancement_used_rate}`,
  );
  console.log(
    `llm_call_rate=${report.metrics.llm_call_rate} llm_streaming_rate=${report.metrics.llm_streaming_rate} llm_fallback_rate=${report.metrics.llm_fallback_rate}`,
  );

  if (report.experiment.enabled) {
    console.log(
      `experiment_rag_top1_delta=${report.experiment.delta?.rag_top1_hit ?? 0} experiment_rag_top3_delta=${report.experiment.delta?.rag_top3_hit ?? 0}`,
    );
  } else if (report.experiment.skipped_reason) {
    console.log(`experiment_skipped=${report.experiment.skipped_reason}`);
  }
}

async function isLiveApiAvailable(agentServerUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${agentServerUrl.replace(/\/+$/, "")}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function parseCliArgs(argv: string[]): RunPhase3EvaluationOptions {
  const options: RunPhase3EvaluationOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--mode" && next) {
      options.mode = next as EvalMode;
      index += 1;
      continue;
    }

    if (arg === "--dataset" && next) {
      options.datasetPath = next;
      index += 1;
      continue;
    }

    if (arg === "--report" && next) {
      options.reportPath = next;
      index += 1;
      continue;
    }

    if (arg === "--markdown" && next) {
      options.markdownReportPath = next;
      index += 1;
      continue;
    }

    if (arg === "--agent-server-url" && next) {
      options.agentServerUrl = next;
      index += 1;
      continue;
    }

    if (arg === "--no-experiment") {
      options.runExperimentComparison = false;
      continue;
    }

    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
  }

  return options;
}

export async function runPhase3Evaluation(
  options: RunPhase3EvaluationOptions = {},
): Promise<Phase3EvalReport> {
  const { dataset, path: datasetPath } = await loadPhase3EvalDataset(options.datasetPath);
  const requestedMode = options.mode ?? "offline";
  const agentServerUrl = options.agentServerUrl ?? DEFAULT_AGENT_SERVER_URL;
  const liveApiAvailable = await isLiveApiAvailable(agentServerUrl);
  const mode =
    requestedMode === "auto"
      ? liveApiAvailable
        ? "live"
        : "offline"
      : requestedMode;

  if (mode === "live" && !liveApiAvailable) {
    throw new Phase3EvalError(
      `Agent server is not reachable at ${agentServerUrl}. Start agent-server or use --mode offline.`,
    );
  }

  const results: Phase3EvalSampleResult[] = [];
  for (const sample of dataset.samples) {
    try {
      const result =
        mode === "live"
          ? await callLive(sample, agentServerUrl)
          : await callOffline(sample);
      results.push(result);
    } catch (error: unknown) {
      results.push(buildFailureSampleResult(sample, error));
    }
  }

  const metricDetails = buildMetricDetails(results, dataset.samples);
  const experiment = await runExperimentComparison(dataset.samples, results, options);
  const availability = getLlmAvailability();

  const report: Phase3EvalReport = {
    generated_at: new Date().toISOString(),
    mode,
    dataset: {
      path: datasetPath,
      version: dataset.version,
      sample_count: dataset.samples.length,
      counts_by_category: {
        structured: dataset.samples.filter((sample) => sample.category === "structured").length,
        rag: dataset.samples.filter((sample) => sample.category === "rag").length,
        follow_up: dataset.samples.filter((sample) => sample.category === "follow_up").length,
      },
    },
    environment: {
      llm_available: availability.enabled,
      llm_reason: availability.reason,
      live_api_url: mode === "live" ? agentServerUrl : undefined,
      live_api_available: liveApiAvailable,
    },
    metrics: buildMetrics(metricDetails),
    metric_details: metricDetails,
    samples: results,
    experiment,
  };

  const reportPath =
    options.reportPath ?? getRepoPath("evaluation", "reports", "phase3_eval_report.json");
  const markdownReportPath =
    options.markdownReportPath ??
    getRepoPath("evaluation", "reports", "phase3_eval_report.md");

  await ensureDirectory(reportPath);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await ensureDirectory(markdownReportPath);
  await fs.writeFile(markdownReportPath, buildMarkdownReport(report), "utf8");

  if (!options.quiet) {
    logSummary(report);
  }

  return report;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);
  await runPhase3Evaluation(options);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof EvalDatasetError ||
      error instanceof Phase3EvalError ||
      error instanceof Error
        ? error.message
        : "Phase 3 evaluation failed.";

    console.error(message);
    process.exitCode = 1;
  });
}
