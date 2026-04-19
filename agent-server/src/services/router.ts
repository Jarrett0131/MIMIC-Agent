import { resolveTool, type ToolContext, type ToolResult } from "../agent/toolRegistry";
import type { InternalQuestionType } from "../types";

export function routeQuestion(
  ctx: ToolContext,
  questionType: InternalQuestionType,
): {
  tool: string;
  args: Record<string, unknown>;
  execute: () => Promise<ToolResult>;
} {
  return resolveTool(questionType, ctx);
}
