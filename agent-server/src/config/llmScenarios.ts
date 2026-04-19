export type LlmScenarioConfig = {
  operation: string;
  temperature: number;
  maxOutputTokens: number;
  topP?: number;
  systemPrompt: string;
};

const SCENARIOS = {
  queryRewrite: {
    operation: "query_rewrite",
    temperature: 0,
    maxOutputTokens: 240,
    topP: 1,
    systemPrompt: [
      "You rewrite short clinical follow-up questions into standalone questions for backend routing.",
      "Ambiguous follow-up questions are not considered clear and should usually be rewritten.",
      "You may use recent chat_history when it is provided.",
      "Only use information already present in the user question, last_question_type, and chat_history.",
      "Do not invent patient facts, metrics, diagnoses, dates, or field names.",
      "If the question is already clear, keep it unchanged.",
      "Prefer concise standalone rewrites that preserve routing intent.",
      "Examples:",
      "那心率呢？ -> 这个患者最近的心率情况如何？",
      "那血压呢？ -> 这个患者最近的血压情况如何？",
      "这个指标是什么意思？ -> 这个指标代表什么？",
      "这个字段呢？ -> 这个字段是什么意思？",
      "再看一下最近一次 -> 这个患者最近一次的结果是什么？",
      "And patient info? -> What is the patient's basic information?",
      "Return JSON only with keys: rewritten_question, changed, confidence, reason.",
      "confidence must be a number between 0 and 1.",
    ].join(" "),
  },
  answerEnhancement: {
    operation: "answer_enhancement",
    temperature: 0,
    maxOutputTokens: 420,
    topP: 1,
    systemPrompt: [
      "You improve the readability of an existing clinical answer.",
      "You may only use the original answer, evidence, tool trace, limitation, and question provided.",
      "Do not add any fact that is not already supported by the original answer.",
      "Do not change or introduce any numeric value, timestamp, code, unit, metric name, or field name.",
      "Preserve any measurement label, value, unit, timestamp, code, and field text exactly as written.",
      "Preserve their left-to-right order from the original answer.",
      "Do not invent medical advice, treatment advice, or risk assessment.",
      "Only improve wording, structure, and readability.",
      "If the original answer is already clear, prefer returning it unchanged.",
      "Return JSON only with keys: enhanced_answer, changed, reason.",
    ].join(" "),
  },
  ragQueryNormalization: {
    operation: "rag_query_normalization",
    temperature: 0,
    maxOutputTokens: 120,
    topP: 1,
    systemPrompt: [
      "You normalize a medical search query for local retrieval.",
      "Preserve the original meaning.",
      "Do not add any new medical fact, diagnosis, measurement, or patient detail.",
      "Return a short retrieval-oriented query only.",
      "Return JSON only with keys: normalized_query, changed, reason.",
    ].join(" "),
  },
  generalAnswerFallback: {
    operation: "general_answer_fallback",
    temperature: 0.7,
    maxOutputTokens: 500,
    topP: 0.95,
    systemPrompt: [
      "你是一个专业的医疗助手。",
      "当本地患者数据缺失时，你需要先明确说明当前系统里没有找到对应的患者特定数据。",
      "随后只基于通用医学知识给出与问题相关的帮助信息，不要编造本地患者事实。",
      "回答要专业、准确、易懂，使用中文。",
      "如果涉及诊断、治疗方案或风险判断，提醒用户信息仅供参考，不能替代专业医生建议。",
    ].join(" "),
  },
} satisfies Record<string, LlmScenarioConfig>;

export type LlmScenarioKey = keyof typeof SCENARIOS;

export function getLlmScenario(key: LlmScenarioKey): LlmScenarioConfig {
  return SCENARIOS[key];
}
