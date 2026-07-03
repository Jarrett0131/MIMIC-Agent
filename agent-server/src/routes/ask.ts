import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";

import { buildAskLogEntry, logAskRequest } from "../logging";
import { runWithRequestContext } from "../logging";
import {
  buildDefaultDiagnostics,
  buildInvalidRequestResponse,
  parseAskRequest,
  runMastraAsk,
  wantsStreamResponse,
} from "../services/mastraAsk";
import type { AskPipelineDiagnostics, AskResponse, AskStreamEvent } from "../types";

const router = Router();

function readQuestionFromBody(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "";
  }

  const question = (body as { question?: unknown }).question;
  return typeof question === "string" ? question.trim() : "";
}

function writeAskLog(args: {
  requestId: string;
  createdAt: string;
  startedAt: number;
  hadmId: number | string;
  question: string;
  response: AskResponse;
  diagnostics: AskPipelineDiagnostics;
}): void {
  logAskRequest(
    buildAskLogEntry({
      requestId: args.requestId,
      hadmId: args.hadmId,
      question: args.question,
      response: args.response,
      diagnostics: args.diagnostics,
      totalDurationMs: Date.now() - args.startedAt,
      createdAt: args.createdAt,
    }),
  );
}

function buildInvalidRequestDiagnostics(
  question: string,
  response: AskResponse,
): AskPipelineDiagnostics {
  const diagnostics = buildDefaultDiagnostics(question);
  diagnostics.rewrite.reason = "invalid_request";
  diagnostics.error_code = response.error?.code ?? undefined;
  return diagnostics;
}

function buildStreamMetaResponse(response: AskResponse): AskResponse {
  if (!response.success) {
    return response;
  }

  const workflowState =
    response.workflow_state[response.workflow_state.length - 1] === "done"
      ? response.workflow_state.slice(0, -1)
      : response.workflow_state;

  return {
    ...response,
    answer: "",
    workflow_state: workflowState.length > 0 ? workflowState : response.workflow_state,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function writeStreamEvent(res: Response, event: AskStreamEvent): boolean {
  if (res.writableEnded) {
    return false;
  }

  res.write(`${JSON.stringify(event)}\n`);
  return true;
}

async function streamAskResponse(
  req: Request,
  res: Response,
  requestMeta: {
    requestId: string;
    createdAt: string;
    startedAt: number;
  },
) {
  const payload = parseAskRequest(req.body);
  const rawQuestion = readQuestionFromBody(req.body);

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  if (!payload) {
    const invalidResponse = buildInvalidRequestResponse(req.body);
    writeAskLog({
      requestId: requestMeta.requestId,
      createdAt: requestMeta.createdAt,
      startedAt: requestMeta.startedAt,
      hadmId: "unknown",
      question: rawQuestion,
      response: invalidResponse,
      diagnostics: buildInvalidRequestDiagnostics(rawQuestion, invalidResponse),
    });
    writeStreamEvent(res, {
      type: "complete",
      response: invalidResponse,
    });
    res.end();
    return;
  }

  let connectionClosed = false;
  req.on("aborted", () => {
    connectionClosed = true;
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      connectionClosed = true;
    }
  });

  const result = await runMastraAsk(payload, {
    onWorkflow: async (workflowState) => {
      if (connectionClosed) {
        return;
      }

      const stage = workflowState[workflowState.length - 1];
      if (!stage || stage === "idle") {
        return;
      }

      writeStreamEvent(res, {
        type: "workflow",
        workflow_state: workflowState,
        stage,
      });
    },
    onAnswerDelta: async (delta, answer) => {
      if (connectionClosed) {
        return;
      }

      writeStreamEvent(res, {
        type: "answer_delta",
        delta,
        answer,
      });
      await yieldToEventLoop();
    },
  });

  if (connectionClosed || res.writableEnded) {
    res.end();
    return;
  }

  writeAskLog({
    requestId: requestMeta.requestId,
    createdAt: requestMeta.createdAt,
    startedAt: requestMeta.startedAt,
    hadmId: payload.hadm_id,
    question: payload.question,
    response: result.response,
    diagnostics: result.diagnostics,
  });

  if (!result.ok) {
    writeStreamEvent(res, {
      type: "complete",
      response: result.response,
    });
    res.end();
    return;
  }

  // Answer deltas were already streamed natively via onAnswerDelta; emit the
  // metadata (evidence, tool trace, suggestions) and the final response.
  writeStreamEvent(res, {
    type: "meta",
    response: buildStreamMetaResponse(result.response),
  });
  writeStreamEvent(res, {
    type: "complete",
    response: result.response,
  });
  res.end();
}

router.post("/", async (req: Request, res: Response) => {
  const requestId = randomUUID();
  const createdAt = new Date().toISOString();
  const startedAt = Date.now();

  await runWithRequestContext(requestId, async () => {
    if (wantsStreamResponse(req.body)) {
      await streamAskResponse(req, res, {
        requestId,
        createdAt,
        startedAt,
      });
      return;
    }

    const payload = parseAskRequest(req.body);
    const rawQuestion = readQuestionFromBody(req.body);
    if (!payload) {
      const invalidResponse = buildInvalidRequestResponse(req.body);
      writeAskLog({
        requestId,
        createdAt,
        startedAt,
        hadmId: "unknown",
        question: rawQuestion,
        response: invalidResponse,
        diagnostics: buildInvalidRequestDiagnostics(rawQuestion, invalidResponse),
      });
      res.status(400).json(invalidResponse);
      return;
    }

    const result = await runMastraAsk(payload);
    writeAskLog({
      requestId,
      createdAt,
      startedAt,
      hadmId: payload.hadm_id,
      question: payload.question,
      response: result.response,
      diagnostics: result.diagnostics,
    });

    if (result.ok) {
      res.json(result.response);
      return;
    }

    res.status(result.status).json(result.response);
  });
});

export default router;
