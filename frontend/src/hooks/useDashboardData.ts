import { useEffect, useState } from "react";

import { fetchRecentLabs, fetchRecentVitals } from "../api/dashboard";
import { isAbortError } from "../api/http";
import type { LabRecord, VitalRecord } from "../types";

type DashboardDataState = {
  loading: boolean;
  error: string;
  labs: LabRecord[];
  vitals: VitalRecord[];
};

const INITIAL_DASHBOARD_DATA: DashboardDataState = {
  loading: false,
  error: "",
  labs: [],
  vitals: [],
};

export function useDashboardData(currentHadmId: number | null): DashboardDataState {
  const [dashboardData, setDashboardData] =
    useState<DashboardDataState>(INITIAL_DASHBOARD_DATA);

  useEffect(() => {
    if (currentHadmId === null) {
      setDashboardData(INITIAL_DASHBOARD_DATA);
      return;
    }

    const activeHadmId = currentHadmId;

    const controller = new AbortController();
    let isCancelled = false;

    setDashboardData({
      loading: true,
      error: "",
      labs: [],
      vitals: [],
    });

    async function loadDashboardData() {
      const results = await Promise.allSettled([
        fetchRecentVitals(activeHadmId, "heart rate", 12, controller.signal),
        fetchRecentVitals(activeHadmId, "blood pressure", 12, controller.signal),
        fetchRecentLabs(activeHadmId, "lactate", 12, controller.signal),
        fetchRecentLabs(activeHadmId, "creatinine", 12, controller.signal),
      ]);

      if (isCancelled) {
        return;
      }

      const nextVitals: VitalRecord[] = [];
      const nextLabs: LabRecord[] = [];
      const errors: string[] = [];
      const [heartRateResult, bloodPressureResult, lactateResult, creatinineResult] = results;

      [
        { label: "heart rate", result: heartRateResult },
        { label: "blood pressure", result: bloodPressureResult },
      ].forEach(({ label, result }) => {
        if (result.status === "rejected") {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : "加载看板数据失败。";
          errors.push(`${label}: ${message}`);
          return;
        }

        nextVitals.push(...result.value.records);
      });

      [
        { label: "lactate", result: lactateResult },
        { label: "creatinine", result: creatinineResult },
      ].forEach(({ label, result }) => {
        if (result.status === "rejected") {
          const message =
            result.reason instanceof Error
              ? result.reason.message
              : "加载看板数据失败。";
          errors.push(`${label}: ${message}`);
          return;
        }

        nextLabs.push(...result.value.records);
      });

      setDashboardData({
        loading: false,
        error: errors.join("; "),
        labs: nextLabs,
        vitals: nextVitals,
      });
    }

    void loadDashboardData().catch((error: unknown) => {
      if (isCancelled || isAbortError(error)) {
        return;
      }

      setDashboardData({
        loading: false,
        error:
          error instanceof Error ? error.message : "加载患者看板数据失败。",
        labs: [],
        vitals: [],
      });
    });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [currentHadmId]);

  return dashboardData;
}
