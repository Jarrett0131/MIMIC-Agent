export function getQuestionTypeLabel(questionType: string | null): string {
  switch (questionType) {
    case "patient_info":
      return "患者概况";
    case "lab_query":
      return "实验室结果";
    case "vital_query":
      return "生命体征";
    case "diagnosis_query":
      return "诊断";
    case "term_explanation":
      return "术语解释";
    case "metric_explanation":
      return "指标解释";
    case "field_explanation":
      return "字段解释";
    case "knowledge_query":
      return "知识问答";
    default:
      return questionType ?? "-";
  }
}
