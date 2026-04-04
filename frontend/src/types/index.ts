/**
 * 与 FastAPI `app/schemas.py` 对齐：字段名、含义与 POST /ask 响应键一致（snake_case）。
 * evidence / tool_args 为开放 JSON 对象，使用 Record 避免 any。
 */

export interface IcuStayBrief {
  stay_id: number | null;
  intime: string | null;
  outtime: string | null;
  los: number | null;
}

export interface DiagnosisBrief {
  seq_num: number | null;
  icd_code: string | null;
  icd_version: number | null;
}

export interface PatientOverviewResponse {
  hadm_id: number;
  subject_id: number | null;
  gender: string | null;
  anchor_age: number | null;
  admittime: string | null;
  dischtime: string | null;
  icu_stays: IcuStayBrief[];
  diagnoses: DiagnosisBrief[];
}

export interface AskRequest {
  hadm_id: number;
  question: string;
}

/** 与后端 `schemas.QuestionType` / AskResponse.question_type 取值一致 */
export type QuestionType =
  | "overview"
  | "diagnosis"
  | "lab"
  | "vital"
  | "unknown";

export type JsonObject = Record<string, unknown>;

export interface AskResponse {
  question_type: QuestionType;
  tool_called: string;
  tool_args: JsonObject;
  answer: string;
  evidence: JsonObject[];
  limitation: string;
}

export interface HttpErrorBody {
  detail?: string | unknown;
}
