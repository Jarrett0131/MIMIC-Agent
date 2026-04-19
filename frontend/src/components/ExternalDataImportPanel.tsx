import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MutableRefObject,
} from "react";

import type { ClinicalDataImportResponse } from "../types";
import { AppCard } from "./ui/AppCard";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

type ImportMode = "csv" | "excel" | "json";
type CsvFieldKey = "patientsCsv" | "diagnosesCsv" | "labsCsv" | "vitalsCsv";
type ImportRequestPayload =
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

type ExternalDataImportPanelProps = {
  disabled?: boolean;
  importing: boolean;
  error: string;
  lastImport: ClinicalDataImportResponse | null;
  history: ClinicalDataImportResponse[];
  historyLoading: boolean;
  deletingImportId: string | null;
  onImport: (payload: ImportRequestPayload) => void | Promise<void>;
  onDeleteImport: (importId: string) => void | Promise<void>;
  onRefreshHistory: () => void | Promise<void>;
};

const SAMPLE_IMPORT_JSON = `{
  "metadata": {
    "name": "External ICU Demo",
    "source": "manual-import",
    "description": "One imported patient for quick verification"
  },
  "patients": [
    {
      "hadm_id": 900001,
      "patient_overview": {
        "subject_id": 500001,
        "gender": "F",
        "age": 67,
        "admittime": "2026-04-16T08:30:00Z",
        "dischtime": "2026-04-20T10:00:00Z",
        "admission_type": "URGENT",
        "admission_location": "ED",
        "discharge_location": "HOME",
        "race": "ASIAN",
        "icu_stay_id": 700001,
        "icu_intime": "2026-04-16T10:30:00Z",
        "icu_outtime": "2026-04-18T09:00:00Z"
      },
      "diagnoses": [
        {
          "seq_num": 1,
          "icd_code": "A41.9",
          "icd_version": 10
        }
      ],
      "labs": [
        {
          "itemid": 50813,
          "label": "Lactate",
          "charttime": "2026-04-16T09:00:00Z",
          "value": "3.2",
          "valuenum": 3.2,
          "valueuom": "mmol/L",
          "flag": "abnormal"
        }
      ],
      "vitals": [
        {
          "itemid": 220045,
          "label": "Heart Rate",
          "charttime": "2026-04-16T09:05:00Z",
          "value": "112",
          "valuenum": 112,
          "valueuom": "bpm",
          "warning": 1
        }
      ]
    }
  ]
}`;

const SAMPLE_PATIENTS_CSV = `hadm_id,subject_id,gender,age,admittime,dischtime,admission_type,admission_location,discharge_location,race,icu_stay_id,icu_intime,icu_outtime
900001,500001,F,67,2026-04-16T08:30:00Z,2026-04-20T10:00:00Z,URGENT,ED,HOME,ASIAN,700001,2026-04-16T10:30:00Z,2026-04-18T09:00:00Z`;

const SAMPLE_DIAGNOSES_CSV = `hadm_id,seq_num,icd_code,icd_version
900001,1,A41.9,10`;

const SAMPLE_LABS_CSV = `hadm_id,itemid,label,charttime,value,valuenum,valueuom,flag
900001,50813,Lactate,2026-04-16T09:00:00Z,3.2,3.2,mmol/L,abnormal`;

const SAMPLE_VITALS_CSV = `hadm_id,itemid,label,charttime,value,valuenum,valueuom,warning
900001,220045,Heart Rate,2026-04-16T09:05:00Z,112,112,bpm,1`;

function formatImportedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function ExternalDataImportPanel({
  disabled = false,
  importing,
  error,
  lastImport,
  history,
  historyLoading,
  deletingImportId,
  onImport,
  onDeleteImport,
  onRefreshHistory,
}: ExternalDataImportPanelProps) {
  const [mode, setMode] = useState<ImportMode>("csv");
  const [datasetName, setDatasetName] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [excelWorkbookBase64, setExcelWorkbookBase64] = useState("");
  const [excelWorkbookName, setExcelWorkbookName] = useState("");
  const [csvDraft, setCsvDraft] = useState<Record<CsvFieldKey, string>>({
    patientsCsv: "",
    diagnosesCsv: "",
    labsCsv: "",
    vitalsCsv: "",
  });
  const [csvFileNames, setCsvFileNames] = useState<Record<CsvFieldKey, string>>({
    patientsCsv: "",
    diagnosesCsv: "",
    labsCsv: "",
    vitalsCsv: "",
  });

  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const excelFileInputRef = useRef<HTMLInputElement | null>(null);
  const patientsFileInputRef = useRef<HTMLInputElement | null>(null);
  const diagnosesFileInputRef = useRef<HTMLInputElement | null>(null);
  const labsFileInputRef = useRef<HTMLInputElement | null>(null);
  const vitalsFileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "json") {
      await onImport({
        mode: "json",
        datasetName,
        rawJson,
      });
      return;
    }

    if (mode === "excel") {
      await onImport({
        mode: "excel",
        datasetName,
        workbookBase64: excelWorkbookBase64,
        workbookName: excelWorkbookName || undefined,
      });
      return;
    }

    await onImport({
      mode: "csv",
      datasetName,
      csvBundle: {
        patientsCsv: csvDraft.patientsCsv,
        diagnosesCsv: csvDraft.diagnosesCsv.trim() || undefined,
        labsCsv: csvDraft.labsCsv.trim() || undefined,
        vitalsCsv: csvDraft.vitalsCsv.trim() || undefined,
      },
    });
  }

  function setCsvSample(): void {
    setCsvDraft({
      patientsCsv: SAMPLE_PATIENTS_CSV,
      diagnosesCsv: SAMPLE_DIAGNOSES_CSV,
      labsCsv: SAMPLE_LABS_CSV,
      vitalsCsv: SAMPLE_VITALS_CSV,
    });
    setCsvFileNames({
      patientsCsv: "sample-patients.csv",
      diagnosesCsv: "sample-diagnoses.csv",
      labsCsv: "sample-labs.csv",
      vitalsCsv: "sample-vitals.csv",
    });
    if (!datasetName.trim()) {
      setDatasetName("external-icu-demo");
    }
  }

  function getCsvFileInputRef(
    field: CsvFieldKey,
  ): MutableRefObject<HTMLInputElement | null> {
    switch (field) {
      case "patientsCsv":
        return patientsFileInputRef;
      case "diagnosesCsv":
        return diagnosesFileInputRef;
      case "labsCsv":
        return labsFileInputRef;
      case "vitalsCsv":
        return vitalsFileInputRef;
      default:
        return patientsFileInputRef;
    }
  }

  async function handleJsonFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setRawJson(await file.text());
    if (!datasetName.trim()) {
      setDatasetName(file.name.replace(/\.json$/i, ""));
    }
    event.target.value = "";
  }

  async function handleExcelFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const buffer = await file.arrayBuffer();
    setExcelWorkbookBase64(arrayBufferToBase64(buffer));
    setExcelWorkbookName(file.name);

    if (!datasetName.trim()) {
      setDatasetName(file.name.replace(/\.xlsx$/i, ""));
    }

    event.target.value = "";
  }

  async function handleCsvFileChange(
    field: CsvFieldKey,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setCsvDraft((current) => ({
      ...current,
      [field]: text,
    }));
    setCsvFileNames((current) => ({
      ...current,
      [field]: file.name,
    }));

    if (!datasetName.trim()) {
      setDatasetName(file.name.replace(/\.(csv|txt)$/i, ""));
    }

    event.target.value = "";
  }

  const isSubmitDisabled =
    disabled ||
    importing ||
    (mode === "json"
      ? !rawJson.trim()
      : mode === "excel"
        ? !excelWorkbookBase64.trim()
        : !csvDraft.patientsCsv.trim());

  return (
    <AppCard
      className="import-card"
      title="导入外部数据"
      subtitle="优先使用 CSV 表格导入；如果数据已经整理成统一结构，也可以直接导入 JSON 或 Excel。"
      actions={
        <StatusBadge tone={lastImport ? "success" : "neutral"}>
          {lastImport ? "已导入" : "待导入"}
        </StatusBadge>
      }
    >
      <div className="import-panel">
        <div className="import-mode-tabs" role="tablist" aria-label="导入模式">
          <button
            className={`canvas-tab ${mode === "csv" ? "canvas-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={mode === "csv"}
            onClick={() => setMode("csv")}
            disabled={disabled || importing}
          >
            CSV 表格
          </button>
          <button
            className={`canvas-tab ${mode === "excel" ? "canvas-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={mode === "excel"}
            onClick={() => setMode("excel")}
            disabled={disabled || importing}
          >
            Excel 工作簿
          </button>
          <button
            className={`canvas-tab ${mode === "json" ? "canvas-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={mode === "json"}
            onClick={() => setMode("json")}
            disabled={disabled || importing}
          >
            JSON 数据包
          </button>
        </div>

        <form className="import-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="field-label" htmlFor="external-dataset-name">
              数据集名称
            </label>
            <input
              id="external-dataset-name"
              className="header-patient-input import-input"
              value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)}
              placeholder="例如：external-icu-demo"
              disabled={disabled || importing}
            />
          </div>

          {mode === "json" ? (
            <div className="import-mode-panel">
              <p className="import-helper-text">
                当你的外部数据已经整理成 `patient / diagnoses / labs / vitals`
                这一类统一结构时，直接粘贴或上传 JSON 会更方便。
              </p>
              <div className="input-group">
                <label className="field-label" htmlFor="external-dataset-json">
                  JSON 数据包
                </label>
                <textarea
                  id="external-dataset-json"
                  className="command-input import-textarea"
                  value={rawJson}
                  onChange={(event) => setRawJson(event.target.value)}
                  placeholder="粘贴外部临床数据 JSON"
                  spellCheck={false}
                  disabled={disabled || importing}
                />
              </div>
              <div className="query-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setRawJson(SAMPLE_IMPORT_JSON);
                    if (!datasetName.trim()) {
                      setDatasetName("external-icu-demo");
                    }
                  }}
                  disabled={disabled || importing}
                >
                  填充 JSON 示例
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => jsonFileInputRef.current?.click()}
                  disabled={disabled || importing}
                >
                  选择 JSON 文件
                </button>
                <input
                  ref={jsonFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={handleJsonFileChange}
                />
              </div>
            </div>
          ) : mode === "excel" ? (
            <div className="import-mode-panel">
              <p className="import-helper-text">
                上传一个 `.xlsx` 工作簿。必须包含 `patients` 工作表，可选包含
                `diagnoses`、`labs`、`vitals`。工作表名不区分大小写，并会忽略空格、
                连字符和下划线。
              </p>
              <div className="query-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => excelFileInputRef.current?.click()}
                  disabled={disabled || importing}
                >
                  选择 Excel 文件
                </button>
                <input
                  ref={excelFileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={handleExcelFileChange}
                />
              </div>
              <div className="import-excel-guide">
                <div className="summary-tile">
                  <span className="summary-tile-label">工作簿</span>
                  <strong>{excelWorkbookName || "尚未选择文件"}</strong>
                </div>
                <div className="summary-tile">
                  <span className="summary-tile-label">必需工作表</span>
                  <strong>`patients`</strong>
                </div>
                <div className="summary-tile import-summary-wide">
                  <span className="summary-tile-label">可选工作表</span>
                  <strong>`diagnoses`、`labs`、`vitals`</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className="import-mode-panel">
              <p className="import-helper-text">
                必填：`patients_csv`，并且需要包含 `hadm_id` 列。可选表格可以继续补充
                诊断、化验、生命体征记录，但必须使用相同的 `hadm_id` 关联。
              </p>
              <div className="query-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={setCsvSample}
                  disabled={disabled || importing}
                >
                  填充 CSV 示例
                </button>
              </div>

              <div className="import-csv-grid">
                {[
                  {
                    key: "patientsCsv" as const,
                    label: "patients.csv",
                    required: true,
                    placeholder: "hadm_id,subject_id,gender,age,admittime,...",
                  },
                  {
                    key: "diagnosesCsv" as const,
                    label: "diagnoses.csv",
                    required: false,
                    placeholder: "hadm_id,seq_num,icd_code,icd_version",
                  },
                  {
                    key: "labsCsv" as const,
                    label: "labs.csv",
                    required: false,
                    placeholder: "hadm_id,itemid,label,charttime,value,valuenum,...",
                  },
                  {
                    key: "vitalsCsv" as const,
                    label: "vitals.csv",
                    required: false,
                    placeholder: "hadm_id,itemid,label,charttime,value,valuenum,...",
                  },
                ].map((field) => (
                  <div className="input-group" key={field.key}>
                    <div className="import-inline-actions">
                      <label className="field-label" htmlFor={field.key}>
                        {field.label} {field.required ? "（必填）" : "（可选）"}
                      </label>
                      <button
                        className="secondary-button import-file-button"
                        type="button"
                        onClick={() => getCsvFileInputRef(field.key).current?.click()}
                        disabled={disabled || importing}
                      >
                        选择文件
                      </button>
                    </div>
                    <textarea
                      id={field.key}
                      className="command-input import-csv-textarea"
                      value={csvDraft[field.key]}
                      onChange={(event) =>
                        setCsvDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      spellCheck={false}
                      disabled={disabled || importing}
                    />
                    <input
                      ref={getCsvFileInputRef(field.key)}
                      type="file"
                      accept=".csv,text/csv,.txt"
                      hidden
                      onChange={(event) => handleCsvFileChange(field.key, event)}
                    />
                    <p className="import-helper-text">
                      {csvFileNames[field.key]
                        ? `已加载：${csvFileNames[field.key]}`
                        : "可以直接粘贴 CSV 内容，也可以选择本地文件。"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="query-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitDisabled}
            >
              {importing ? "导入中..." : "开始导入"}
            </button>
          </div>
        </form>

        {error ? <div className="error-box">{error}</div> : null}

        {lastImport ? (
          <div className="import-summary-grid">
            <div className="summary-tile">
              <span className="summary-tile-label">数据集</span>
              <strong>{lastImport.dataset_name}</strong>
            </div>
            <div className="summary-tile">
              <span className="summary-tile-label">患者数量</span>
              <strong>{lastImport.patient_count}</strong>
            </div>
            <div className="summary-tile">
              <span className="summary-tile-label">化验 / 生命体征 / 诊断</span>
              <strong>
                {lastImport.record_counts.labs} / {lastImport.record_counts.vitals} /{" "}
                {lastImport.record_counts.diagnoses}
              </strong>
            </div>
            <div className="summary-tile">
              <span className="summary-tile-label">导入时间</span>
              <strong>{formatImportedAt(lastImport.imported_at)}</strong>
            </div>
            <div className="summary-tile import-summary-wide">
              <span className="summary-tile-label">导入的 hadm_id</span>
              <strong>{lastImport.hadm_ids.join(", ")}</strong>
            </div>
          </div>
        ) : (
          <EmptyState
            title="还没有导入外部数据"
            description="如果只是快速接入，建议优先使用 CSV；如果数据已经规范化，再选择 JSON 或 Excel。"
          />
        )}

        <div className="import-history-section">
          <div className="import-inline-actions">
            <div>
              <h3 className="section-title">导入历史</h3>
              <p className="section-caption">
                这里可以管理已导入的数据集，不会影响本地演示数据。
              </p>
            </div>
            <button
              className="secondary-button import-file-button"
              type="button"
              onClick={() => void onRefreshHistory()}
              disabled={disabled || importing || historyLoading}
            >
              {historyLoading ? "刷新中..." : "刷新"}
            </button>
          </div>

          {history.length === 0 ? (
            <EmptyState
              title="暂时没有已保存的导入记录"
              description="每次成功导入的数据集都会显示在这里，之后也可以单独删除。"
            />
          ) : (
            <div className="import-history-list">
              {history.map((item) => {
                const isDeleting = deletingImportId === item.import_id;
                const isLatest = lastImport?.import_id === item.import_id;

                return (
                  <div className="import-history-card" key={item.import_id}>
                    <div className="import-history-header">
                      <div>
                        <div className="import-inline-actions">
                          <strong>{item.dataset_name}</strong>
                          {isLatest ? <StatusBadge tone="info">最新</StatusBadge> : null}
                        </div>
                        <p className="import-helper-text">
                          {item.patient_count} 位患者，{item.record_counts.labs} 条化验，
                          {item.record_counts.vitals} 条生命体征，{item.record_counts.diagnoses} 条诊断
                        </p>
                        <p className="import-helper-text">
                          导入于 {formatImportedAt(item.imported_at)}
                        </p>
                        <p className="import-helper-text">
                          hadm_id: {item.hadm_ids.join(", ")}
                        </p>
                      </div>
                      <button
                        className="secondary-button import-file-button import-delete-button"
                        type="button"
                        onClick={() => void onDeleteImport(item.import_id)}
                        disabled={disabled || importing || isDeleting}
                      >
                        {isDeleting ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppCard>
  );
}
