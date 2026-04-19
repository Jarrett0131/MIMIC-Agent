import type { StructuredQuestionType } from "../types";

export type QuestionRule = {
  type: StructuredQuestionType;
  patterns: RegExp[];
};

export const LAB_METRIC_PATTERNS: RegExp[] = [
  /\u5316\u9a8c/u,
  /\u68c0\u9a8c/u,
  /lab/i,
  /wbc/i,
  /white blood cell/i,
  /\u767d\u7ec6\u80de/u,
  /\u8840\u7cd6/u,
  /\u8461\u8404\u7cd6/u,
  /glucose/i,
  /blood sugar/i,
  /hemoglobin/i,
  /haemoglobin/i,
  /\bhb\b/i,
  /\u8840\u7ea2\u86cb\u767d/u,
  /lactate/i,
  /\u4e73\u9178/u,
  /creatinine/i,
  /\u808c\u9150/u,
];

export const VITAL_METRIC_PATTERNS: RegExp[] = [
  /\u751f\u547d\u4f53\u5f81/u,
  /\u5fc3\u7387/u,
  /heart rate/i,
  /pulse/i,
  /\bhr\b/i,
  /\u8840\u538b/u,
  /blood pressure/i,
  /\bbp\b/i,
  /temperature/i,
  /\u4f53\u6e29/u,
  /spo2/i,
  /oxygen saturation/i,
  /\u8840\u6c27/u,
];

export const DIAGNOSIS_PATTERNS: RegExp[] = [
  /\u8bca\u65ad/u,
  /\u75c5\u53f2/u,
  /diagnoses?/i,
  /icd/i,
  /sepsis/i,
  /\u8113\u6bd2\u75c7/u,
  /\u8d25\u8840/u,
  /pneumonia/i,
  /\u80ba\u708e/u,
  /acute kidney injury/i,
  /\baki\b/i,
  /\u6025\u6027\u80be\u635f\u4f24/u,
];

export const PATIENT_INFO_PATTERNS: RegExp[] = [
  /\u60a3\u8005\u4fe1\u606f/u,
  /\u57fa\u672c\u4fe1\u606f/u,
  /\u4f4f\u9662\u4fe1\u606f/u,
  /\u6982\u89c8/u,
  /\u6982\u51b5/u,
  /\u5165\u9662/u,
  /\u51fa\u9662/u,
  /icu/i,
  /patient info/i,
  /patient overview/i,
  /demographics/i,
  /age/i,
  /gender/i,
  /\u6027\u522b/u,
  /\u5e74\u9f84/u,
];

export const FIELD_PATTERNS: RegExp[] = [
  /\bhadm[_\s-]?id\b/i,
  /hospital admission id/i,
  /charttime/i,
  /field/i,
  /column/i,
  /\u5b57\u6bb5/u,
  /\u4f4f\u9662\u53f7/u,
  /\u8bb0\u5f55\u65f6\u95f4/u,
  /\u56fe\u8868\u65f6\u95f4/u,
];

export const EXPLANATION_INTENT_PATTERNS: RegExp[] = [
  /\u4ec0\u4e48\u610f\u601d/u,
  /\u4ee3\u8868\u4ec0\u4e48/u,
  /\u542b\u4e49/u,
  /\u89e3\u91ca/u,
  /\u600e\u4e48\u7406\u89e3/u,
  /\u4e00\u822c\u8868\u793a\u4ec0\u4e48/u,
  /\u662f\u4ec0\u4e48\u5b57\u6bb5/u,
  /\u662f\u4ec0\u4e48\u7f29\u5199/u,
  /does .* mean/i,
  /what does .* mean/i,
  /what does .* measure/i,
  /meaning of/i,
  /\bdefine\b/i,
  /\bexplain\b/i,
];

export const DEFINITION_PATTERNS: RegExp[] = [
  /\u662f\u4ec0\u4e48/u,
  /\u662f\u5565/u,
  /what is/i,
  /what's/i,
];

export const RESULT_INTENT_PATTERNS: RegExp[] = [
  /\u6700\u8fd1/u,
  /\u6700\u65b0/u,
  /\u7ed3\u679c/u,
  /latest/i,
  /recent/i,
  /result/i,
  /reading/i,
  /\u60c5\u51b5/u,
  /\u591a\u5c11/u,
  /\u6570\u503c/u,
];

export const QUESTION_RULES: QuestionRule[] = [
  {
    type: "lab_query",
    patterns: LAB_METRIC_PATTERNS,
  },
  {
    type: "vital_query",
    patterns: VITAL_METRIC_PATTERNS,
  },
  {
    type: "diagnosis_query",
    patterns: DIAGNOSIS_PATTERNS,
  },
  {
    type: "patient_info",
    patterns: PATIENT_INFO_PATTERNS,
  },
];
