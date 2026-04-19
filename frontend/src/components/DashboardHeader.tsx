import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AgentStage, PatientOverviewResponse } from "../types";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge } from "./ui/StatusBadge";

type PatientOption = {
  hadmId: string;
};

type DashboardHeaderProps = {
  currentHadmId: number | null;
  hadmIdInput: string;
  patientData: PatientOverviewResponse | null;
  stage: AgentStage;
  patientLoading: boolean;
  askLoading: boolean;
  patientOptions: PatientOption[];
  patientOptionsTotal: number;
  patientOptionsLoading: boolean;
  patientOptionsError: string;
  onHadmIdInputChange: (value: string) => void;
  onLoadPatient: () => void | Promise<void>;
  onSelectPatientOption: (hadmId: string) => void;
  onReloadPatientOptions: () => void;
};

function getStatus(stage: AgentStage, patientLoading: boolean, askLoading: boolean) {
  if (patientLoading) {
    return {
      label: "正在加载患者信息",
      tone: "warning" as const,
    };
  }

  if (
    askLoading ||
    stage === "classifying" ||
    stage === "tool_running" ||
    stage === "answering"
  ) {
    return {
      label: "正在生成回答",
      tone: "info" as const,
    };
  }

  if (stage === "error") {
    return {
      label: "需要注意",
      tone: "error" as const,
    };
  }

  return {
    label: "就绪",
    tone: "success" as const,
  };
}

function formatGender(value: unknown): string {
  if (typeof value !== "string") {
    return "未知性别";
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "M") {
    return "男";
  }

  if (normalized === "F") {
    return "女";
  }

  return value.trim() || "未知性别";
}

function buildPatientBadge(
  currentHadmId: number | null,
  patientData: PatientOverviewResponse | null,
): string | null {
  if (!patientData || currentHadmId === null) {
    return null;
  }

  const overview = patientData.patient_overview;
  const gender = formatGender(overview.gender);
  const age = typeof overview.age === "number" ? `${overview.age} 岁` : "年龄未知";
  const firstDiagnosis = patientData.diagnoses[0];
  const diagnosisLabel =
    typeof firstDiagnosis?.icd_code === "string" && firstDiagnosis.icd_code.trim()
      ? `ICD ${firstDiagnosis.icd_code.trim()}`
      : `${patientData.diagnoses.length} 个诊断`;

  return `入院 ${currentHadmId} | ${gender} | ${age} | ${diagnosisLabel}`;
}

export function DashboardHeader({
  currentHadmId,
  hadmIdInput,
  patientData,
  stage,
  patientLoading,
  askLoading,
  patientOptions,
  patientOptionsTotal,
  patientOptionsLoading,
  patientOptionsError,
  onHadmIdInputChange,
  onLoadPatient,
  onSelectPatientOption,
  onReloadPatientOptions,
}: DashboardHeaderProps) {
  const [isPatientListOpen, setIsPatientListOpen] = useState(false);
  const [patientSearchKeyword, setPatientSearchKeyword] = useState("");
  const patientListContainerRef = useRef<HTMLFormElement | null>(null);
  const status = getStatus(stage, patientLoading, askLoading);
  const patientBadge = buildPatientBadge(currentHadmId, patientData);
  const totalCount = patientOptionsTotal > 0 ? patientOptionsTotal : patientOptions.length;
  const canOpenPatientList =
    patientOptionsLoading || Boolean(patientOptionsError) || totalCount > 0;
  const filteredPatientOptions = useMemo(() => {
    const keyword = patientSearchKeyword.trim();
    if (!keyword) {
      return patientOptions;
    }

    return patientOptions.filter((option) => option.hadmId.includes(keyword));
  }, [patientOptions, patientSearchKeyword]);

  useEffect(() => {
    if (!isPatientListOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!patientListContainerRef.current?.contains(event.target as Node)) {
        setIsPatientListOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPatientListOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPatientListOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onLoadPatient();
  }

  return (
    <header className="dashboard-header">
      <div className="dashboard-brand">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-mark-inner" />
        </div>
        <div>
          <h1 className="dashboard-title">临床数据助手</h1>
        </div>
      </div>

      <form className="header-loader" onSubmit={handleSubmit} ref={patientListContainerRef}>
        <label className="header-loader-label" htmlFor="patient-id-input">
          入院 ID
        </label>
        <div className="header-loader-row">
          <input
            id="patient-id-input"
            className="header-patient-input"
            value={hadmIdInput}
            onChange={(event) => onHadmIdInputChange(event.target.value)}
            placeholder="输入入院 ID"
            disabled={patientLoading || askLoading}
          />
          <button
            className="primary-button header-load-button"
            type="submit"
            disabled={patientLoading || askLoading}
          >
            {patientLoading ? "加载中..." : "加载患者"}
          </button>
          <button
            className="secondary-button header-patient-list-button"
            type="button"
            disabled={!canOpenPatientList}
            aria-expanded={isPatientListOpen}
            aria-controls="patient-id-panel"
            onClick={() => setIsPatientListOpen((open) => !open)}
          >
            {patientOptionsLoading
              ? "加载列表中..."
              : isPatientListOpen
                ? "隐藏列表"
                : "浏览入院记录"}
          </button>
        </div>

        {isPatientListOpen && (
          <div className="patient-id-panel" id="patient-id-panel">
            <div className="patient-id-panel-header">
              <p className="patient-id-note">
                共 <strong>{totalCount}</strong> 条入院记录
                {patientSearchKeyword.trim()
                  ? `，匹配 ${filteredPatientOptions.length} 条`
                  : ""}
              </p>
              <StatusBadge
                tone={patientOptionsError ? "error" : patientOptionsLoading ? "warning" : "neutral"}
              >
                {patientOptionsError
                  ? "加载失败"
                  : patientOptionsLoading
                    ? "加载中"
                    : `${patientOptions.length} 条可用`}
              </StatusBadge>
            </div>

            <div className="patient-id-panel-toolbar">
              <input
                className="header-patient-input patient-id-search"
                value={patientSearchKeyword}
                onChange={(event) => setPatientSearchKeyword(event.target.value)}
                placeholder="筛选入院 ID"
                disabled={patientOptionsLoading}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={onReloadPatientOptions}
                disabled={patientOptionsLoading}
              >
                刷新列表
              </button>
            </div>

            <div className="patient-id-panel-content">
              {patientOptionsError ? (
                <div className="error-box">{patientOptionsError}</div>
              ) : patientOptionsLoading && patientOptions.length === 0 ? (
                <p className="patient-id-note">正在加载入院 ID...</p>
              ) : filteredPatientOptions.length === 0 ? (
                <EmptyState
                  title="没有匹配的入院 ID"
                  description="请尝试使用不同的关键词。"
                />
              ) : (
                <div className="patient-id-grid">
                  {filteredPatientOptions.map((option) => {
                    const isActive = String(currentHadmId ?? "") === option.hadmId;

                    return (
                      <button
                        key={option.hadmId}
                        className={`patient-id-button ${isActive ? "patient-id-button-active" : ""}`}
                        type="button"
                        onClick={() => {
                          setIsPatientListOpen(false);
                          onSelectPatientOption(option.hadmId);
                        }}
                        disabled={patientLoading || askLoading}
                      >
                        <div className="patient-id-button-header">
                          <span className="patient-id-button-label">入院 ID</span>
                          {isActive && <StatusBadge tone="info">当前</StatusBadge>}
                        </div>
                        <strong className="patient-id-button-value">{option.hadmId}</strong>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </form>

      <div className="header-context">
        <div className="patient-badge-card">
          <span className="patient-badge-label">当前患者</span>
          <strong className="patient-badge-value">{patientBadge ?? "未选择患者"}</strong>
        </div>
        <div className="header-badges">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge tone={currentHadmId === null ? "neutral" : "info"}>
            {currentHadmId === null ? "等待入院 ID" : `入院 ${currentHadmId}`}
          </StatusBadge>
        </div>
      </div>
    </header>
  );
}
