import { useEffect, useRef, useState } from "react";

import { isAbortError } from "../api/http";
import { fetchPatientIds } from "../api/patient";

export type PatientOption = {
  hadmId: string;
};

type PatientOptionsState = {
  patientOptions: PatientOption[];
  patientOptionsTotal: number;
  patientOptionsLoading: boolean;
  patientOptionsError: string;
};

function buildPatientOptions(hadmIds: number[]): PatientOption[] {
  return Array.from(
    new Set(
      hadmIds
        .map((hadmId) => String(hadmId).trim())
        .filter((hadmId) => hadmId.length > 0),
    ),
  )
    .sort((left, right) => Number(left) - Number(right))
    .map((hadmId) => ({ hadmId }));
}

export function usePatientOptions(): PatientOptionsState & {
  reloadPatientOptions: () => void;
} {
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [patientOptionsTotal, setPatientOptionsTotal] = useState(0);
  const [patientOptionsLoading, setPatientOptionsLoading] = useState(false);
  const [patientOptionsError, setPatientOptionsError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCancelled = false;

    setPatientOptionsLoading(true);
    setPatientOptionsError("");

    async function loadPatientOptions() {
      try {
        const payload = await fetchPatientIds(controller.signal);
        if (isCancelled) {
          return;
        }

        const nextOptions = buildPatientOptions(payload.hadm_ids);
        setPatientOptions(nextOptions);
        setPatientOptionsTotal(
          typeof payload.total === "number" && payload.total > 0
            ? payload.total
            : nextOptions.length,
        );
      } catch (error: unknown) {
        if (isCancelled || isAbortError(error)) {
          return;
        }

        setPatientOptionsError(
          error instanceof Error ? error.message : "加载入院列表失败。",
        );
      } finally {
        if (!isCancelled) {
          setPatientOptionsLoading(false);
        }
      }
    }

    void loadPatientOptions();

    return () => {
      isCancelled = true;
      controller.abort();
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
    };
  }, [reloadToken]);

  function reloadPatientOptions() {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
    }
    reloadTimerRef.current = setTimeout(() => {
      setReloadToken((value) => value + 1);
    }, 300);
  }

  return {
    patientOptions,
    patientOptionsTotal,
    patientOptionsLoading,
    patientOptionsError,
    reloadPatientOptions,
  };
}
