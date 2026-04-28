import { useCallback, useRef } from "react";

import { askQuestionStream } from "../api/ask";
import { isAbortError } from "../api/http";
import type { AgentAction } from "../store/agentReducer";
import type { AskResponse, ConversationContext, DebugRequestEntry } from "../types";
import { normalizeQuestionInput } from "../utils/questions";

type AskSessionDebugApi = {
  pushDebugRequest: (question: string) => { id: string; startedAt: number };
  patchDebugRequest: (
    id: string,
    updater: (entry: DebugRequestEntry) => DebugRequestEntry,
  ) => void;
};

type SubmitQuestionOptions = {
  hadmId: number | null;
  question: string;
  context: ConversationContext;
};

function buildResponseDebugPatch(response: AskResponse) {
  return {
    questionType: response.question_type,
    toolNames: response.tool_trace?.map((trace) => trace.tool) ?? [],
    routeType: response.routing?.route_type ?? null,
    routeFamily: response.routing?.route_family ?? null,
    enhancement: response.enhancement,
    diagnostics: response.diagnostics,
    errorCode: response.error?.code,
  };
}

export function useAskSession(
  dispatch: React.Dispatch<AgentAction>,
  debugApi: AskSessionDebugApi,
) {
  const activeAskControllerRef = useRef<AbortController | null>(null);
  const { pushDebugRequest, patchDebugRequest } = debugApi;

  const submitQuestion = useCallback(
    async ({ hadmId, question, context }: SubmitQuestionOptions) => {
      const activeHadmId = hadmId ?? context.hadm_id;

      if (activeHadmId === null) {
        dispatch({
          type: "ASK_ERROR",
          payload: {
            turnId: null,
            message: "请先加载患者，再进行提问。",
          },
        });
        return;
      }

      const normalizedQuestion = normalizeQuestionInput(question);
      if (!normalizedQuestion) {
        dispatch({
          type: "ASK_ERROR",
          payload: {
            turnId: null,
            message: "请输入问题后再发送。",
          },
        });
        return;
      }

      activeAskControllerRef.current?.abort();
      const controller = new AbortController();
      activeAskControllerRef.current = controller;
      const debugRequest = pushDebugRequest(normalizedQuestion);
      const turnId = debugRequest.id;

      dispatch({
        type: "ASK_START",
        payload: {
          turnId,
          question: normalizedQuestion,
        },
      });
      dispatch({ type: "SET_STAGE", payload: "classifying" });

      try {
        const result = await askQuestionStream(
          {
            hadm_id: activeHadmId,
            question: normalizedQuestion,
            context,
          },
          {
            signal: controller.signal,
            onWorkflow: (workflowState) => {
              if (activeAskControllerRef.current !== controller) {
                return;
              }

              const nextStage = workflowState[workflowState.length - 1];
              if (nextStage && nextStage !== "idle") {
                dispatch({ type: "SET_STAGE", payload: nextStage });
              }
            },
            onMeta: (response: AskResponse) => {
              if (activeAskControllerRef.current !== controller) {
                return;
              }

              patchDebugRequest(debugRequest.id, (entry) => ({
                ...entry,
                ...buildResponseDebugPatch(response),
              }));

              dispatch({
                type: "ASK_STREAM_META",
                payload: {
                  turnId,
                  response,
                },
              });
            },
            onAnswerDelta: (delta: string) => {
              if (activeAskControllerRef.current !== controller) {
                return;
              }

              dispatch({
                type: "ASK_STREAM_ANSWER_CHUNK",
                payload: {
                  turnId,
                  delta,
                },
              });
            },
          },
        );

        if (activeAskControllerRef.current === controller) {
          activeAskControllerRef.current = null;
        }

        patchDebugRequest(debugRequest.id, (entry) => ({
          ...entry,
          ...buildResponseDebugPatch(result),
          success: result.success,
          durationMs: performance.now() - debugRequest.startedAt,
          status: result.success ? "completed" : "failed",
        }));

        dispatch({
          type: "ASK_SUCCESS",
          payload: {
            turnId,
            response: result,
          },
        });
      } catch (error: unknown) {
        if (activeAskControllerRef.current === controller) {
          activeAskControllerRef.current = null;
        }

        if (isAbortError(error)) {
          patchDebugRequest(debugRequest.id, (entry) => ({
            ...entry,
            durationMs: performance.now() - debugRequest.startedAt,
            status: "cancelled",
            success: false,
          }));

          dispatch({
            type: "ASK_CANCELLED",
            payload: {
              turnId,
              message: "已停止本次回答生成。",
            },
          });
          return;
        }

        patchDebugRequest(debugRequest.id, (entry) => ({
          ...entry,
          durationMs: performance.now() - debugRequest.startedAt,
          status: "failed",
          success: false,
        }));

        dispatch({
          type: "ASK_ERROR",
          payload: {
            turnId,
            message: error instanceof Error ? error.message : "本次请求失败。",
          },
        });
      }
    },
    [dispatch, patchDebugRequest, pushDebugRequest],
  );

  const handleCancelAsk = useCallback(() => {
    activeAskControllerRef.current?.abort();
    activeAskControllerRef.current = null;
  }, []);

  return {
    submitQuestion,
    handleCancelAsk,
  };
}
