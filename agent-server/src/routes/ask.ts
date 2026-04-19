import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";

import { buildAskLogEntry, logAskRequest } from "../logging/askLogger";
import { runWithRequestContext } from "../logging/requestContext";
import {
  buildInvalidRequestResponse,
  parseAskRequest,
  runAskPipeline,
  wantsStreamResponse,
} from "../services/askPipeline";
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
  return {
    original_question: question,
    resolved_question: question,
    rewrite: {
      enabled: false,
      original_question: question,
      rewritten_question: question,
      changed: false,
      source: "none",
      reason: "invalid_request",
      guard_applied: false,
      guard_reason: "invalid_request",
    },
    rag: {
      enabled: false,
      used: false,
      matched: false,
      knowledge_types: [],
      top_results: [],
    },
    success: false,
    error_code: response.error?.code ?? undefined,
  };
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

  const pipelineResult = await runAskPipeline(payload, {
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

  if (!pipelineResult.ok) {
    writeAskLog({
      requestId: requestMeta.requestId,
      createdAt: requestMeta.createdAt,
      startedAt: requestMeta.startedAt,
      hadmId: payload.hadm_id,
      question: payload.question,
      response: pipelineResult.response,
      diagnostics: pipelineResult.diagnostics,
    });
    writeStreamEvent(res, {
      type: "complete",
      response: pipelineResult.response,
    });
    res.end();
    return;
  }

  const metaResponse = buildStreamMetaResponse(pipelineResult.response);
  writeAskLog({
    requestId: requestMeta.requestId,
    createdAt: requestMeta.createdAt,
    startedAt: requestMeta.startedAt,
    hadmId: payload.hadm_id,
    question: payload.question,
    response: pipelineResult.response,
    diagnostics: pipelineResult.diagnostics,
  });
  writeStreamEvent(res, {
    type: "meta",
    response: metaResponse,
  });

  if (!pipelineResult.streamedAnswer) {
    let accumulatedAnswer = "";
    for (const chunk of pipelineResult.answerChunks) {
      if (connectionClosed || res.writableEnded) {
        break;
      }

      accumulatedAnswer += chunk;
      writeStreamEvent(res, {
        type: "answer_delta",
        delta: chunk,
        answer: accumulatedAnswer,
      });
      await yieldToEventLoop();
    }
  }

  if (!connectionClosed && !res.writableEnded) {
    writeStreamEvent(res, {
      type: "complete",
      response: pipelineResult.response,
    });
  }

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

    const pipelineResult = await runAskPipeline(payload);
    writeAskLog({
      requestId,
      createdAt,
      startedAt,
      hadmId: payload.hadm_id,
      question: payload.question,
      response: pipelineResult.response,
      diagnostics: pipelineResult.diagnostics,
    });

    if (pipelineResult.ok) {
      res.json(pipelineResult.response);
      return;
    }

    res.status(pipelineResult.status).json(pipelineResult.response);
  });
});

export default router;
