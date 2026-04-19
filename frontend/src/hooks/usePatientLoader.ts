import { useCallback, useRef } from "react";
import { fetchPatient } from "../api/patient";
import type { AgentAction } from "../store/agentReducer";
import type { DataCanvasTab } from "../components/PatientDataCanvas";

export function usePatientLoader(dispatch: React.Dispatch<AgentAction>) {
  const activeAskControllerRef = useRef<AbortController | null>(null);

  const loadPatientByValue = useCallback(async (rawHadmId: string, options?: {
    setActiveCanvasTab?: (tab: DataCanvasTab) => void;
    setHoveredAnswerLink?: (link: any) => void;
    setSelectedAnswerLink?: (link: any) => void;
  }) => {
    const parsedHadmId = Number.parseInt(rawHadmId.trim(), 10);
    if (Number.isNaN(parsedHadmId) || parsedHadmId <= 0) {
      dispatch({
        type: "LOAD_PATIENT_ERROR",
        payload: "请输入有效的入院 ID。",
      });
      return;
    }

    // 停止当前正在进行的提问
    activeAskControllerRef.current?.abort();
    
    // 重置相关状态
    options?.setActiveCanvasTab?.("vitals");
    options?.setHoveredAnswerLink?.(null);
    options?.setSelectedAnswerLink?.(null);

    dispatch({ type: "LOAD_PATIENT_START" });

    try {
      const patientData = await fetchPatient(parsedHadmId);
      dispatch({
        type: "LOAD_PATIENT_SUCCESS",
        payload: {
          hadmId: parsedHadmId,
          data: patientData,
        },
      });
    } catch (error: unknown) {
      dispatch({
        type: "LOAD_PATIENT_ERROR",
        payload: error instanceof Error ? error.message : "加载患者信息失败。",
      });
    }
  }, [dispatch]);

  const selectPatientAndSyncInput = useCallback(async (hadmId: number, options?: {
    setActiveCanvasTab?: (tab: DataCanvasTab) => void;
    setHoveredAnswerLink?: (link: any) => void;
    setSelectedAnswerLink?: (link: any) => void;
  }) => {
    dispatch({
      type: "SET_HADM_ID_INPUT",
      payload: String(hadmId),
    });
    await loadPatientByValue(String(hadmId), options);
  }, [dispatch, loadPatientByValue]);

  return {
    loadPatientByValue,
    selectPatientAndSyncInput,
    activeAskControllerRef,
  };
}

