import type { RagExperimentOverrides } from "../agent/rag/embeddingTypes";
import type {
  InternalQuestionType,
  StructuredQuestionType,
  ToolTraceItem,
} from "../types";

export type Phase3EvalCategory = "structured" | "rag" | "follow_up";

export type Phase3EvalTool =
  | "fetchPatient"
  | "fetchDiagnoses"
  | "fetchRecentLabs"
  | "fetchRecentVitals"
  | "retrieveKnowledge";

export type Phase3EvalRewriteExpectation = {
  trigger: boolean;
  changed?: boolean;
  rewritten_contains?: string[];
};

export type Phase3EvalSample = {
  id: string;
  category: Phase3EvalCategory;
  question: string;
  hadm_id: number;
  language?: "zh" | "en" | "mixed";
  context?: {
    hadm_id?: number;
    last_question_type?: StructuredQuestionType | null;
  };
  expected_route: InternalQuestionType;
  expected_tool: Phase3EvalTool;
  expected_titles?: string[];
  expected_keywords?: string[];
  expected_rewrite?: Phase3EvalRewriteExpectation;
  requires_evidence?: boolean;
  tags?: string[];
  notes?: string;
};

export type Phase3EvalDataset = {
  version: string;
  default_hadm_id: number;
  samples: Phase3EvalSample[];
};

export type Phase3EvalMetricDetail = {
  hit: number;
  total: number;
  rate: number;
};

export type Phase3EvalMetrics = {
  route_accuracy: number;
  tool_accuracy: number;
  rag_top1_hit: number;
  rag_top3_hit: number;
  rag_miss_rate: number;
  rag_enhancement_used_rate: number;
  rewrite_trigger_rate: number;
  rewrite_expected_hit: number;
  rewrite_by_llm_rate: number;
  rewrite_by_fallback_rate: number;
  answer_success_rate: number;
  evidence_presence_rate: number;
  answer_enhancement_applied_rate: number;
  answer_enhancement_fallback_rate: number;
  llm_call_rate: number;
  llm_streaming_rate: number;
  llm_fallback_rate: number;
};

export type Phase3EvalMetricDetails = {
  route_accuracy: Phase3EvalMetricDetail;
  tool_accuracy: Phase3EvalMetricDetail;
  rag_top1_hit: Phase3EvalMetricDetail;
  rag_top3_hit: Phase3EvalMetricDetail;
  rag_miss_rate: Phase3EvalMetricDetail;
  rag_enhancement_used_rate: Phase3EvalMetricDetail;
  rewrite_trigger_rate: Phase3EvalMetricDetail;
  rewrite_expected_hit: Phase3EvalMetricDetail;
  rewrite_by_llm_rate: Phase3EvalMetricDetail;
  rewrite_by_fallback_rate: Phase3EvalMetricDetail;
  answer_success_rate: Phase3EvalMetricDetail;
  evidence_presence_rate: Phase3EvalMetricDetail;
  answer_enhancement_applied_rate: Phase3EvalMetricDetail;
  answer_enhancement_fallback_rate: Phase3EvalMetricDetail;
  llm_call_rate: Phase3EvalMetricDetail;
  llm_streaming_rate: Phase3EvalMetricDetail;
  llm_fallback_rate: Phase3EvalMetricDetail;
};

export type Phase3EvalSampleResult = {
  id: string;
  category: Phase3EvalCategory;
  question: string;
  hadm_id: number;
  expected_route: InternalQuestionType;
  predicted_question_type: InternalQuestionType | null;
  expected_tool: Phase3EvalTool;
  predicted_tool: string | null;
  route_hit: boolean;
  tool_hit: boolean;
  original_question: string;
  rewritten_question: string;
  rewrite_changed: boolean;
  rewrite_source: "llm" | "fallback" | "none";
  rewrite_confidence?: number;
  rewrite_expected_hit?: boolean;
  answer_success: boolean;
  answer_non_empty: boolean;
  evidence_non_empty: boolean;
  answer_enhancement_called: boolean;
  answer_enhancement_applied: boolean;
  enhancement_fallback: boolean;
  llm_call_count: number;
  llm_streamed: boolean;
  llm_fallback_used: boolean;
  rag_miss: boolean;
  rag_enhancement_used: boolean;
  top1_title?: string;
  top3_titles: string[];
  rag_top1_hit?: boolean;
  rag_top3_hit?: boolean;
  keyword_coverage?: number;
  tool_trace: ToolTraceItem[];
  error_code?: string;
  notes?: string;
};

export type Phase3EvalExperimentReport = {
  enabled: boolean;
  config?: RagExperimentOverrides;
  metrics?: Pick<Phase3EvalMetrics, "rag_top1_hit" | "rag_top3_hit">;
  metric_details?: Pick<Phase3EvalMetricDetails, "rag_top1_hit" | "rag_top3_hit">;
  delta?: {
    rag_top1_hit: number;
    rag_top3_hit: number;
  };
  improved_samples: Array<{
    id: string;
    question: string;
    expected_titles: string[];
    baseline_top3_titles: string[];
    experiment_top3_titles: string[];
  }>;
  degraded_samples: Array<{
    id: string;
    question: string;
    expected_titles: string[];
    baseline_top3_titles: string[];
    experiment_top3_titles: string[];
  }>;
  unchanged_samples: number;
  skipped_reason?: string;
};

export type Phase3EvalReport = {
  generated_at: string;
  mode: "offline" | "live";
  dataset: {
    path: string;
    version: string;
    sample_count: number;
    counts_by_category: Record<Phase3EvalCategory, number>;
  };
  environment: {
    llm_available: boolean;
    llm_reason?: string;
    live_api_url?: string;
    live_api_available?: boolean;
  };
  metrics: Phase3EvalMetrics;
  metric_details: Phase3EvalMetricDetails;
  samples: Phase3EvalSampleResult[];
  experiment: Phase3EvalExperimentReport;
};
