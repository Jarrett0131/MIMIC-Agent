import type {
  AnswerEvidenceLink,
  ConversationTurn,
  EvidenceItem,
  InternalQuestionType,
  StructuredQuestionType,
  ToolTraceItem,
} from "../../types";

export type QueryRewriteInput = {
  question: string;
  hadm_id: number;
  last_question_type: StructuredQuestionType | null;
  chat_history?: ConversationTurn[];
};

export type QueryRewriteSource = "llm" | "fallback" | "none";

export type QueryRewriteResult = {
  enabled: boolean;
  original_question: string;
  rewritten_question: string;
  changed: boolean;
  source: QueryRewriteSource;
  confidence?: number;
  reason?: string;
  guard_applied?: boolean;
  guard_reason?: string;
};

export type AnswerEnhancementInput = {
  question: string;
  question_type: InternalQuestionType;
  answer: string;
  evidence: EvidenceItem[];
  tool_trace: ToolTraceItem[];
  answer_links: AnswerEvidenceLink[];
  limitation: string[];
};

export type AnswerEnhancementResult = {
  enabled: boolean;
  called: boolean;
  original_answer: string;
  enhanced_answer: string;
  changed: boolean;
  applied: boolean;
  fallback: boolean;
  answer_links: AnswerEvidenceLink[];
  reason?: string;
  fallback_reason?: string;
};
