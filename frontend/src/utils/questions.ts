export function normalizeQuestionInput(rawQuestion: string): string {
  const trimmedQuestion = rawQuestion.trim();
  if (!trimmedQuestion.startsWith("/")) {
    return trimmedQuestion;
  }

  const match = trimmedQuestion.match(/^\/([a-zA-Z]+)\s*(.*)$/);
  if (!match) {
    return trimmedQuestion;
  }

  const [, command, remainder] = match;
  const normalizedCommand = command.toLowerCase();

  if (
    normalizedCommand === "rag" ||
    normalizedCommand === "explain" ||
    normalizedCommand === "ask"
  ) {
    return remainder.trim();
  }

  if (normalizedCommand === "report") {
    return remainder.trim() || "请总结这位患者当前的整体情况和诊断。";
  }

  return trimmedQuestion;
}
