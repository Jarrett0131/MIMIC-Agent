import { useCallback, useRef } from "react";
import { askQuestionStream } from "../api/ask";
import { isAbortError } from "../api/http";
import type { AgentAction } from "../store/agentReducer";
import type { AskResponse } from "../types";
import { normalizeQuestionInput } from "../utils/questions";
import { useDebugRequests } from "./useDebugRequests";

export function useAskSession(dispatch: React.Dispatch<AgentAction>) {
  const activeAskControllerRef = useRef<AbortController | null>(null);
  const { pushDebugRequest, patchDebugRequest } = useDebugRequests();

  const submitQuestion = useCallback(async (options?: {
    hadmId?: number;
    question?: string;
    context?: any;
    state?: any;
  }) => {
    const activeHadmId = options?.hadmId ?? options?.state?.currentHadmId ?? options?.state?.context?.hadm_id;

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

    const normalizedQuestion = normalizeQuestionInput(options?.question ?? options?.state?.question);
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
          context: options?.context ?? options?.state?.context,
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
              questionType: response.question_type,
              toolNames: response.tool_trace?.map((trace) => trace.tool) ?? [],
              routeType: response.routing?.route_type ?? null,
              routeFamily: response.routing?.route_family ?? null,
              enhancement: response.enhancement,
              diagnostics: response.diagnostics,
              errorCode: response.error?.code,
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
        questionType: result.question_type,
        toolNames: result.tool_trace?.map((trace) => trace.tool) ?? [],
        success: result.success,
        durationMs: performance.now() - debugRequest.startedAt,
        status: result.success ? "completed" : "failed",
        routeType: result.routing?.route_type ?? null,
        routeFamily: result.routing?.route_family ?? null,
        enhancement: result.enhancement,
        diagnostics: result.diagnostics,
        errorCode: result.error?.code,
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
  }, [dispatch, pushDebugRequest, patchDebugRequest]);

  const handleAskQuestion = useCallback(async (question?: string, context?: any, state?: any) => {
    await submitQuestion({ question, context, state });
  }, [submitQuestion]);

  const handleCancelAsk = useCallback(() => {
    activeAskControllerRef.current?.abort();
    activeAskControllerRef.current = null;
  }, []);

  return {
    submitQuestion,
    handleAskQuestion,
    handleCancelAsk,
    activeAskControllerRef,
  };
}

