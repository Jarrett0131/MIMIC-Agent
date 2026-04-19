import type {
  AgentStage,
  AgentState,
  AskResponse,
  ConversationContext,
  ConversationContextTurn,
  ConversationTurn,
  PatientOverviewResponse,
  SupportedQuestionType,
  WorkflowStage,
} from "../types";

export type AgentAction =
  | { type: "SET_HADM_ID_INPUT"; payload: string }
  | { type: "LOAD_PATIENT_START" }
  | { type: "LOAD_PATIENT_SUCCESS"; payload: { hadmId: number; data: PatientOverviewResponse } }
  | { type: "LOAD_PATIENT_ERROR"; payload: string }
  | { type: "SET_QUESTION"; payload: string }
  | { type: "ASK_START"; payload: { turnId: string; question: string } }
  | { type: "ASK_STREAM_META"; payload: { turnId: string; response: AskResponse } }
  | { type: "ASK_STREAM_ANSWER_CHUNK"; payload: { turnId: string; delta: string } }
  | { type: "ASK_SUCCESS"; payload: { turnId: string; response: AskResponse } }
  | { type: "ASK_ERROR"; payload: { turnId: string | null; message: string } }
  | { type: "ASK_CANCELLED"; payload: { turnId: string | null; message: string } }
  | { type: "SET_STAGE"; payload: AgentStage };

export const initialAgentState: AgentState = {
  hadmIdInput: "",
  currentHadmId: null,
  patientLoading: false,
  patientError: "",
  patientData: null,
  question: "",
  chatHistory: [],
  askLoading: false,
  askError: "",
  askResult: null,
  stage: "idle",
  context: {
    hadm_id: null,
    subject_id: null,
    patient_info: null,
    last_question_type: null,
  },
};

function isWorkflowStage(value: string): value is WorkflowStage {
  return (
    value === "idle" ||
    value === "classifying" ||
    value === "tool_running" ||
    value === "answering" ||
    value === "done" ||
    value === "error"
  );
}

function isQuestionType(value: string): value is SupportedQuestionType {
  return (
    value === "patient_info" ||
    value === "lab_query" ||
    value === "vital_query" ||
    value === "diagnosis_query"
  );
}

function normalizeQuestionType(value: unknown): SupportedQuestionType | null {
  return typeof value === "string" && isQuestionType(value) ? value : null;
}

function buildContextForPatient(
  hadmId: number,
  patientData?: PatientOverviewResponse,
): ConversationContext {
  return {
    hadm_id: hadmId,
    subject_id: (patientData?.patient_overview?.subject_id as number | null) || null,
    patient_info: patientData?.patient_overview || null,
    last_question_type: null,
    chat_history: [],
  };
}

function serializeConversationHistoryForContext(
  turns: ConversationTurn[],
): ConversationContextTurn[] {
  return turns.slice(-6).map((turn) => ({
    id: turn.id,
    question: turn.question,
    response: turn.response
      ? {
          success: turn.response.success,
          question_type: turn.response.question_type,
          answer: turn.response.answer,
        }
      : null,
    status: turn.status,
    error: turn.error,
  }));
}

function resolveConversationContext(
  state: AgentState,
  result: AskResponse,
  chatHistory: ConversationTurn[],
): ConversationContext {
  const hadmId =
    result.context?.hadm_id ??
    state.currentHadmId ??
    state.context.hadm_id ??
    null;
  const subjectId =
    result.context?.subject_id ??
    state.context.subject_id ??
    null;
  const patientInfo =
    result.context?.patient_info ??
    state.context.patient_info ??
    null;
  const lastQuestionType =
    normalizeQuestionType(result.context?.last_question_type) ??
    normalizeQuestionType(result.question_type) ??
    state.context.last_question_type;

  return {
    hadm_id: hadmId,
    subject_id: subjectId,
    patient_info: patientInfo,
    last_question_type: lastQuestionType,
    chat_history: serializeConversationHistoryForContext(chatHistory),
  };
}

function getStageFromAskResponse(result: AskResponse): AgentStage {
  const lastStage = result.workflow_state[result.workflow_state.length - 1];

  if (typeof lastStage === "string" && isWorkflowStage(lastStage)) {
    return lastStage;
  }

  return result.success ? "done" : "error";
}

function buildStreamingPlaceholderResponse(answer: string): AskResponse {
  return {
    success: true,
    question_type: null,
    workflow_state: ["answering"],
    answer,
    evidence: [],
    tool_trace: [],
    limitation: [],
    error: null,
    answer_links: [],
  };
}

function appendConversationTurn(
  turns: ConversationTurn[],
  turnId: string,
  question: string,
): ConversationTurn[] {
  return [
    ...turns,
    {
      id: turnId,
      question,
      response: null,
      status: "streaming",
      error: "",
    },
  ];
}

function updateConversationTurn(
  turns: ConversationTurn[],
  turnId: string | null,
  updater: (turn: ConversationTurn) => ConversationTurn,
): ConversationTurn[] {
  if (!turnId) {
    return turns;
  }

  return turns.map((turn) => (turn.id === turnId ? updater(turn) : turn));
}

function getAskFailureMessage(result: AskResponse): string {
  return result.error?.message ?? "请求失败。";
}

export function getInitialAgentState(): AgentState {
  return initialAgentState;
}

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_HADM_ID_INPUT":
      return {
        ...state,
        hadmIdInput: action.payload,
      };

    case "LOAD_PATIENT_START":
      return {
        ...state,
        patientLoading: true,
        patientError: "",
        patientData: null,
        currentHadmId: null,
        askLoading: false,
        askError: "",
        askResult: null,
        chatHistory: [],
        stage: "loading_patient",
      };

    case "LOAD_PATIENT_SUCCESS":
      return {
        ...state,
        patientLoading: false,
        patientError: "",
        patientData: action.payload.data,
        currentHadmId: action.payload.hadmId,
        askLoading: false,
        askError: "",
        askResult: null,
        chatHistory: [],
        stage: "done",
        context: buildContextForPatient(action.payload.hadmId, action.payload.data),
      };

    case "LOAD_PATIENT_ERROR":
      return {
        ...state,
        patientLoading: false,
        patientError: action.payload,
        patientData: null,
        currentHadmId: null,
        askLoading: false,
        askError: "",
        askResult: null,
        chatHistory: [],
        stage: "error",
        context: {
          hadm_id: null,
          subject_id: null,
          patient_info: null,
          last_question_type: null,
        },
      };

    case "SET_QUESTION":
      return {
        ...state,
        question: action.payload,
      };

    case "ASK_START":
      return {
        ...state,
        question: "",
        chatHistory: appendConversationTurn(
          state.chatHistory,
          action.payload.turnId,
          action.payload.question,
        ),
        askLoading: true,
        askError: "",
        askResult: null,
      };

    case "ASK_STREAM_META": {
      const nextChatHistory = updateConversationTurn(
        state.chatHistory,
        action.payload.turnId,
        (turn) => ({
          ...turn,
          response: {
            ...action.payload.response,
            answer: action.payload.response.answer || turn.response?.answer || "",
          },
          status: "streaming",
          error: "",
        }),
      );

      return {
        ...state,
        askLoading: true,
        askError: "",
        askResult: {
          ...action.payload.response,
          answer: action.payload.response.answer || state.askResult?.answer || "",
        },
        chatHistory: nextChatHistory,
        stage: getStageFromAskResponse(action.payload.response),
        context: resolveConversationContext(state, action.payload.response, nextChatHistory),
      };
    }

    case "ASK_STREAM_ANSWER_CHUNK": {
      const nextAskResult = state.askResult
        ? {
            ...state.askResult,
            answer: `${state.askResult.answer}${action.payload.delta}`,
          }
        : buildStreamingPlaceholderResponse(action.payload.delta);
      const nextChatHistory = updateConversationTurn(
        state.chatHistory,
        action.payload.turnId,
        (turn) => ({
          ...turn,
          response: turn.response
            ? {
                ...turn.response,
                answer: `${turn.response.answer}${action.payload.delta}`,
              }
            : buildStreamingPlaceholderResponse(action.payload.delta),
        }),
      );

      return {
        ...state,
        askResult: nextAskResult,
        chatHistory: nextChatHistory,
      };
    }

    case "ASK_SUCCESS": {
      const nextError = action.payload.response.success
        ? ""
        : getAskFailureMessage(action.payload.response);
      const nextChatHistory = updateConversationTurn(
        state.chatHistory,
        action.payload.turnId,
        (turn) => ({
          ...turn,
          response: action.payload.response,
          status: action.payload.response.success ? "completed" : "failed",
          error: nextError,
        }),
      );

      return {
        ...state,
        askLoading: false,
        askError: nextError,
        askResult: action.payload.response,
        chatHistory: nextChatHistory,
        stage: getStageFromAskResponse(action.payload.response),
        context: resolveConversationContext(state, action.payload.response, nextChatHistory),
      };
    }

    case "ASK_ERROR":
      return {
        ...state,
        askLoading: false,
        askError: action.payload.message,
        askResult: null,
        chatHistory: updateConversationTurn(
          state.chatHistory,
          action.payload.turnId,
          (turn) => ({
            ...turn,
            status: "failed",
            error: action.payload.message,
          }),
        ),
        stage: "error",
      };

    case "ASK_CANCELLED":
      return {
        ...state,
        askLoading: false,
        askError: action.payload.message,
        chatHistory: updateConversationTurn(
          state.chatHistory,
          action.payload.turnId,
          (turn) => ({
            ...turn,
            status: "cancelled",
            error: action.payload.message,
          }),
        ),
        stage: "error",
      };

    case "SET_STAGE":
      return {
        ...state,
        stage: action.payload,
      };

    default:
      return state;
  }
}
