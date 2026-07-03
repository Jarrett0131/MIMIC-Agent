import type { KnowledgeQuestionType } from "../../types";
import type { RagExperimentDiagnostics, RagExperimentOverrides } from "./embeddingTypes";

export type RagEntry = {
  id: string;
  title: string;
  source: string;
  content: string;
  category: "metric" | "field" | "term" | "diagnosis" | "knowledge";
  domain: "lab" | "vital" | "patient" | "diagnosis" | "general";
  aliases: string[];
  keywords: string[];
};

export type RagMatch = {
  id: string;
  title: string;
  source: string;
  chunk: string;
  score: number;
  category: RagEntry["category"];
  domain: RagEntry["domain"];
  matched_terms: string[];
  score_breakdown: {
    exact: number;
    alias: number;
    keyword: number;
    token_overlap: number;
    concept: number;
    category: number;
    domain: number;
    rerank?: number;
    embedding_similarity?: number;
  };
  lexical_score?: number;
  embedding_similarity?: number;
};

export type RagRetrieveInput = {
  question: string;
  routeType: KnowledgeQuestionType;
  limit?: number;
  experiment?: RagExperimentOverrides;
};

export type RagRetrievalResult = {
  enabled: boolean;
  retriever: string;
  items: RagMatch[];
  reason?: string;
  experiment?: RagExperimentDiagnostics;
};
