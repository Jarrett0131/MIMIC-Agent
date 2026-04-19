import { useEffect, useState } from "react";

import {
  deleteClinicalImport,
  fetchClinicalImportHistory,
  importClinicalCsvData,
  importClinicalData,
  importClinicalExcelData,
} from "../api/imports";
import type {
  ClinicalDataBundle,
  ClinicalDataImportListResponse,
  ClinicalDataImportResponse,
} from "../types";

type ImportSubmission =
  | {
      mode: "json";
      datasetName: string;
      rawJson: string;
    }
  | {
      mode: "excel";
      datasetName: string;
      workbookBase64: string;
      workbookName?: string;
    }
  | {
      mode: "csv";
      datasetName: string;
      csvBundle: {
        patientsCsv: string;
        diagnosesCsv?: string;
        labsCsv?: string;
        vitalsCsv?: string;
      };
    };

type ImportState = {
  loading: boolean;
  error: string;
  summary: ClinicalDataImportResponse | null;
  history: ClinicalDataImportResponse[];
  historyLoading: boolean;
  deletingImportId: string | null;
};

const INITIAL_IMPORT_STATE: ImportState = {
  loading: false,
  error: "",
  summary: null,
  history: [],
  historyLoading: false,
  deletingImportId: null,
};

type UseClinicalImportsArgs = {
  currentHadmId: number | null;
  onPatientOptionsChanged: () => void;
  onSelectPatient: (hadmId: number) => Promise<void>;
};

export function useClinicalImports({
  currentHadmId,
  onPatientOptionsChanged,
  onSelectPatient,
}: UseClinicalImportsArgs) {
  const [importState, setImportState] = useState(INITIAL_IMPORT_STATE);

  useEffect(() => {
    let isCancelled = false;

    async function loadImportHistory() {
      setImportState((current) => ({
        ...current,
        historyLoading: true,
      }));

      try {
        const payload: ClinicalDataImportListResponse =
          await fetchClinicalImportHistory();
        if (isCancelled) {
          return;
        }

        setImportState((current) => ({
          ...current,
          historyLoading: false,
          error: "",
          history: payload.items,
        }));
      } catch (error: unknown) {
        if (isCancelled) {
          return;
        }

        setImportState((current) => ({
          ...current,
          historyLoading: false,
          error: error instanceof Error ? error.message : "加载导入历史失败。",
        }));
      }
    }

    void loadImportHistory();

    return () => {
      isCancelled = true;
    };
  }, []);

  async function refreshImportHistory() {
    setImportState((current) => ({
      ...current,
      historyLoading: true,
    }));

    try {
      const payload = await fetchClinicalImportHistory();
      setImportState((current) => ({
        ...current,
        historyLoading: false,
        error: "",
        history: payload.items,
      }));
    } catch (error: unknown) {
      setImportState((current) => ({
        ...current,
        historyLoading: false,
        error: error instanceof Error ? error.message : "刷新导入历史失败。",
      }));
    }
  }

  async function handleImportClinicalData(options: ImportSubmission) {
    let summary: ClinicalDataImportResponse;

    setImportState((current) => ({
      ...current,
      loading: true,
      error: "",
    }));

    try {
      if (options.mode === "json") {
        let parsedBundle: ClinicalDataBundle;

        try {
          parsedBundle = JSON.parse(options.rawJson) as ClinicalDataBundle;
        } catch {
          setImportState((current) => ({
            ...current,
            loading: false,
            error: "导入失败：JSON 格式无效。",
          }));
          return;
        }

        summary = await importClinicalData({
          dataset_name: options.datasetName.trim() || undefined,
          bundle: parsedBundle,
        });
      } else if (options.mode === "excel") {
        summary = await importClinicalExcelData({
          dataset_name: options.datasetName.trim() || undefined,
          excel_bundle: {
            workbook_base64: options.workbookBase64,
            workbook_name: options.workbookName,
          },
        });
      } else {
        summary = await importClinicalCsvData({
          dataset_name: options.datasetName.trim() || undefined,
          csv_bundle: {
            patients_csv: options.csvBundle.patientsCsv,
            diagnoses_csv: options.csvBundle.diagnosesCsv,
            labs_csv: options.csvBundle.labsCsv,
            vitals_csv: options.csvBundle.vitalsCsv,
          },
        });
      }

      setImportState((current) => ({
        ...current,
        loading: false,
        error: "",
        summary,
        deletingImportId: null,
      }));
      onPatientOptionsChanged();
      void refreshImportHistory();

      const firstImportedHadmId = summary.hadm_ids[0];
      if (typeof firstImportedHadmId === "number" && firstImportedHadmId > 0) {
        await onSelectPatient(firstImportedHadmId);
      }
    } catch (error: unknown) {
      setImportState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "导入外部数据失败。",
      }));
    }
  }

  async function handleDeleteImport(importId: string) {
    setImportState((current) => ({
      ...current,
      deletingImportId: importId,
      error: "",
    }));

    try {
      const deletedImport = await deleteClinicalImport(importId);

      setImportState((current) => ({
        ...current,
        deletingImportId: null,
        summary:
          current.summary?.import_id === deletedImport.import_id ? null : current.summary,
        history: current.history.filter(
          (item) => item.import_id !== deletedImport.import_id,
        ),
      }));

      onPatientOptionsChanged();
      void refreshImportHistory();

      if (currentHadmId !== null && deletedImport.hadm_ids.includes(currentHadmId)) {
        await onSelectPatient(currentHadmId);
      }
    } catch (error: unknown) {
      setImportState((current) => ({
        ...current,
        deletingImportId: null,
        error: error instanceof Error ? error.message : "删除导入数据失败。",
      }));
    }
  }

  return {
    importState,
    refreshImportHistory,
    handleImportClinicalData,
    handleDeleteImport,
  };
}
