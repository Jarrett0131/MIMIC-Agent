export type WorkflowStage =
  | "idle"
  | "classifying"
  | "tool_running"
  | "answering"
  | "done"
  | "error";

export type StructuredQuestionType =
  | "patient_info"
  | "lab_query"
  | "vital_query"
  | "diagnosis_query";

export type KnowledgeQuestionType =
  | "term_explanation"
  | "metric_explanation"
  | "field_explanation"
  | "knowledge_query";

export type InternalQuestionType =
  | StructuredQuestionType
  | KnowledgeQuestionType;

export type QuestionType = StructuredQuestionType;

export type ConversationTurn = {
  
  id: string;
  question: string;
  response: {
    success: boolean;
    question_type: StructuredQuestionType | null;
    answer: string;
  } | null;
  status: "streaming" | "completed" | "failed" | "cancelled";
  error: string;
};

export type ConversationContext = {
  hadm_id: number | null;
  subject_id: number | null;
  patient_info: Record<string, unknown> | null;
  last_question_type: StructuredQuestionType | null;
  chat_history?: ConversationTurn[];
};

export type SuggestionItem = {
  id: string;
  label: string;
  question: string;
};

export type ToolTraceItem = {
  tool: string;
  args: Record<string, unknown>;
  status: "success" | "failed";
  duration_ms: number;
  result_count?: number;
  error_message?: string;
};

export type EvidenceItem = {
  type: "patient" | "diagnosis" | "lab" | "vital" | "medication" | "procedure" | "text";
  title: string;
  content: unknown;
};

export type AnswerEvidenceLink = {
  id: string;
  text: string;
  start: number;
  end: number;
  evidence_type: EvidenceItem["type"];
  evidence_index: number;
  field?: string;
};

export type ErrorSource =
  | "classifier"
  | "router"
  | "python-service"
  | "generator"
  | "server";

export type AppError = {
  code: string;
  message: string;
  source: ErrorSource;
  detail?: unknown;
};

export type RoutingMeta = {
  route_type: InternalQuestionType;
  route_family: "structured" | "rag";
};

export type AskEnhancementMeta = {
  query_rewrite?: {
    enabled: boolean;
    changed: boolean;
    original_question: string;
    rewritten_question: string;
    source: "llm" | "fallback" | "none";
    confidence?: number;
    reason?: string;
    guard_applied?: boolean;
    guard_reason?: string;
  };
  answer_enhancement?: {
    enabled: boolean;
    called: boolean;
    changed: boolean;
    applied: boolean;
    fallback?: boolean;
    fallback_reason?: string;
    reason?: string;
  };
};

export type AskRewriteLog = {
  enabled: boolean;
  original_question: string;
  rewritten_question: string;
  changed: boolean;
  source: "llm" | "fallback" | "none";
  confidence?: number;
  reason?: string;
  guard_applied?: boolean;
  guard_reason?: string;
};

export type AskClassificationLog = {
  route_type: InternalQuestionType;
  display_type: StructuredQuestionType;
  route_family: "structured" | "rag";
};

export type AskRagLog = {
  enabled: boolean;
  used: boolean;
  route_type?: KnowledgeQuestionType;
  retriever?: string;
  matched: boolean;
  reason?: string;
  knowledge_types: Array<"metric" | "field" | "term" | "diagnosis" | "knowledge">;
  top_results: Array<{
    title: string;
    source: string;
    score: number;
    category: "metric" | "field" | "term" | "diagnosis" | "knowledge";
    domain: "lab" | "vital" | "patient" | "diagnosis" | "general";
    matched_terms: string[];
    lexical_score?: number;
    embedding_similarity?: number;
  }>;
  experiment?: {
    enabled: boolean;
    applied: boolean;
    strategy?: string;
    provider?: string;
    model?: string;
    cache_path?: string;
    candidate_count: number;
    rescored_count: number;
    reason?: string;
  };
};

export type AskAnswerEnhancementLog = {
  enabled: boolean;
  called: boolean;
  changed: boolean;
  applied: boolean;
  fallback: boolean;
  fallback_reason?: string;
  reason?: string;
};

export type AskLlmCallLog = {
  operation: string;
  provider: string;
  model: string;
  attempts: number;
  streamed: boolean;
  fallback_used: boolean;
  duration_ms: number;
  output_chars: number;
  status: "success" | "failed" | "budget_rejected";
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated: boolean;
  };
  error_code?: string;
  error_message?: string;
};

export type AskLlmLog = {
  enabled: boolean;
  available: boolean;
  primary_provider: string;
  primary_model: string;
  fallback_providers: string[];
  budget_limit_tokens?: number;
  budget_exceeded: boolean;
  call_count: number;
  streamed: boolean;
  fallback_used: boolean;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  estimated_usage: boolean;
  calls: AskLlmCallLog[];
};

export type AskPipelineDiagnostics = {
  original_question: string;
  resolved_question: string;
  rewrite: AskRewriteLog;
  classification?: AskClassificationLog;
  routed_tool?: string;
  rag?: AskRagLog;
  answer_enhancement?: AskAnswerEnhancementLog;
  llm?: AskLlmLog;
  success: boolean;
  error_code?: string;
};

export type AskResponse = {
  success: boolean;
  question_type: StructuredQuestionType | null;
  workflow_state: WorkflowStage[];
  answer: string;
  evidence: EvidenceItem[];
  tool_trace: ToolTraceItem[];
  limitation: string[];
  error: AppError | null;
  context?: ConversationContext;
  suggestions?: SuggestionItem[];
  answer_links?: AnswerEvidenceLink[];
  enhancement?: AskEnhancementMeta;
  routing?: RoutingMeta;
  diagnostics?: AskPipelineDiagnostics;
};

export interface AskRequest {
  hadm_id: number;
  question: string;
  context?: Partial<ConversationContext>;
  stream?: boolean;
}

export type AskStreamEvent =
  | {
      type: "workflow";
      workflow_state: WorkflowStage[];
      stage: Exclude<WorkflowStage, "idle">;
    }
  | {
      type: "meta";
      response: AskResponse;
    }
  | {
      type: "answer_delta";
      delta: string;
      answer: string;
    }
  | {
      type: "complete";
      response: AskResponse;
    };

export type AgentResponse = {
  answer: string;
  evidence: Array<{
    type: "patient" | "diagnosis" | "lab" | "vital" | "medication" | "procedure" | "text";
    content: any;
  }>;
  tool_trace?: Array<{
    tool: string;
    status: "success" | "error";
    input: any;
    output_summary: string;
  }>;
  missing_info?: string[];
};

export interface PatientOverviewResponse {
  hadm_id: number;
  patient_overview: Record<string, unknown>;
  diagnoses: Record<string, unknown>[];
}

export interface PatientIdListResponse {
  hadm_ids: number[];
  total: number;
}

export interface DiagnosesResponse {
  hadm_id: number;
  diagnoses: Record<string, unknown>[];
}

export interface LabRecordsResponse {
  hadm_id: number;
  keyword: string;
  records: Record<string, unknown>[];
}

export interface VitalRecordsResponse {
  hadm_id: number;
  keyword: string;
  records: Record<string, unknown>[];
}

export interface ExternalClinicalMetadata {
  name?: string | null;
  source?: string | null;
  description?: string | null;
}

export interface ImportedClinicalPatient {
  hadm_id: number;
  patient_overview?: Record<string, unknown>;
  diagnoses?: Record<string, unknown>[];
  labs?: Record<string, unknown>[];
  vitals?: Record<string, unknown>[];
}

export interface ClinicalDataBundle {
  metadata?: ExternalClinicalMetadata;
  patients: ImportedClinicalPatient[];
}

export interface ClinicalDataImportRequest {
  dataset_name?: string;
  bundle: ClinicalDataBundle;
}

export interface ClinicalDataCsvBundle {
  patients_csv: string;
  diagnoses_csv?: string;
  labs_csv?: string;
  vitals_csv?: string;
}

export interface ClinicalDataCsvImportRequest {
  dataset_name?: string;
  csv_bundle: ClinicalDataCsvBundle;
}

export interface ClinicalDataExcelBundle {
  workbook_base64: string;
  workbook_name?: string;
}

export interface ClinicalDataExcelImportRequest {
  dataset_name?: string;
  excel_bundle: ClinicalDataExcelBundle;
}

export interface ClinicalDataImportResponse {
  import_id: string;
  dataset_name: string;
  imported_at: string;
  stored_path: string;
  patient_count: number;
  hadm_ids: number[];
  record_counts: {
    diagnoses: number;
    labs: number;
    vitals: number;
  };
}

export interface ClinicalDataImportListResponse {
  items: ClinicalDataImportResponse[];
  total: number;
}

export type PythonDataResponse =
  | PatientOverviewResponse
  | PatientIdListResponse
  | DiagnosesResponse
  | LabRecordsResponse
  | VitalRecordsResponse
  | ClinicalDataImportResponse
  | ClinicalDataImportListResponse;
