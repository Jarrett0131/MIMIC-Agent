import { useEffect, useMemo, useState } from "react";

import type {
  EvidenceItem,
  LabRecord,
  PatientOverviewResponse,
  VitalRecord,
} from "../types";
import { AppCard } from "./ui/AppCard";
import { EmptyState } from "./ui/EmptyState";
import { InfoField } from "./ui/InfoField";
import { StatusBadge } from "./ui/StatusBadge";

export type DataCanvasTab = "vitals" | "labs";

interface PatientDataCanvasProps {
  currentHadmId: number | null;
  patientData: PatientOverviewResponse | null;
  patientLoading: boolean;
  patientError: string;
  vitals: VitalRecord[];
  labs: LabRecord[];
  dataLoading: boolean;
  dataError: string;
  activeTab: DataCanvasTab;
  onTabChange: (tab: DataCanvasTab) => void;
  focusEvidence: EvidenceItem | null;
  interactionEvidence: EvidenceItem[];
}

type ZoomLevel = 6 | 12 | 24 | "all";

type TimelinePoint = {
  key: string;
  displayTime: string;
  heartRate: number | null;
  bloodPressure: number | null;
};

type FocusTarget = {
  tab: DataCanvasTab | null;
  key: string | null;
  anchorKey: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function formatGender(value: unknown): string {
  if (typeof value !== "string") {
    return formatValue(value);
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "M") {
    return "男";
  }

  if (normalized === "F") {
    return "女";
  }

  return value.trim() || "-";
}

function formatAge(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value} 岁` : "-";
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function toKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMeasurementKey(record: {
  itemid?: number | null;
  label?: string | null;
  charttime?: string | null;
  valuenum?: number | null;
  value?: string | null;
}): string {
  return [
    toKeyPart(record.itemid),
    toKeyPart(record.label),
    toKeyPart(record.charttime),
    toKeyPart(record.valuenum),
    toKeyPart(record.value),
  ].join("|");
}

function buildDiagnosisKey(record: Record<string, unknown>): string {
  return [
    toKeyPart(record.icd_code),
    toKeyPart(record.icd_version),
    toKeyPart(record.seq_num),
  ].join("|");
}

function isHeartRateLabel(label: string | null | undefined): boolean {
  return (label ?? "").toLowerCase().includes("heart rate");
}

function getNumericMeasurement(record: {
  valuenum?: number | null;
  value?: string | null;
}): number | null {
  if (typeof record.valuenum === "number" && Number.isFinite(record.valuenum)) {
    return record.valuenum;
  }

  if (typeof record.value === "string") {
    const parsed = Number.parseFloat(record.value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function buildDisplayMeasurement(record: {
  valuenum?: number | null;
  value?: string | null;
  valueuom?: string | null;
}): string {
  const numericValue = getNumericMeasurement(record);
  const rawValue =
    typeof record.value === "string" && record.value.trim() ? record.value.trim() : null;
  const unit =
    typeof record.valueuom === "string" && record.valueuom.trim()
      ? record.valueuom.trim()
      : "";
  const displayValue = numericValue ?? rawValue ?? "--";

  return unit ? `${displayValue} ${unit}` : String(displayValue);
}

function mergeLabRecords(baseRecords: LabRecord[], evidence: EvidenceItem[]): LabRecord[] {
  const merged = new Map<string, LabRecord>();

  baseRecords.forEach((record) => {
    merged.set(buildMeasurementKey(record), record);
  });

  evidence.forEach((item) => {
    if (item.type !== "lab" || !isRecord(item.content)) {
      return;
    }

    const record: LabRecord = {
      subject_id: readNumber(item.content, "subject_id"),
      hadm_id: readNumber(item.content, "hadm_id"),
      itemid: readNumber(item.content, "itemid"),
      label: readString(item.content, "label"),
      charttime: readString(item.content, "charttime"),
      value: readString(item.content, "value"),
      valuenum: readNumber(item.content, "valuenum"),
      valueuom: readString(item.content, "valueuom"),
      flag: readString(item.content, "flag"),
    };

    merged.set(buildMeasurementKey(record), record);
  });

  return [...merged.values()].sort((left, right) => {
    const leftTime = Date.parse(left.charttime ?? "");
    const rightTime = Date.parse(right.charttime ?? "");
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

function mergeVitalRecords(baseRecords: VitalRecord[], evidence: EvidenceItem[]): VitalRecord[] {
  const merged = new Map<string, VitalRecord>();

  baseRecords.forEach((record) => {
    merged.set(buildMeasurementKey(record), record);
  });

  evidence.forEach((item) => {
    if (item.type !== "vital" || !isRecord(item.content)) {
      return;
    }

    const record: VitalRecord = {
      subject_id: readNumber(item.content, "subject_id"),
      hadm_id: readNumber(item.content, "hadm_id"),
      stay_id: readNumber(item.content, "stay_id"),
      itemid: readNumber(item.content, "itemid"),
      label: readString(item.content, "label"),
      charttime: readString(item.content, "charttime"),
      value: readString(item.content, "value"),
      valuenum: readNumber(item.content, "valuenum"),
      valueuom: readString(item.content, "valueuom"),
      warning: readNumber(item.content, "warning"),
    };

    merged.set(buildMeasurementKey(record), record);
  });

  return [...merged.values()].sort((left, right) => {
    const leftTime = Date.parse(left.charttime ?? "");
    const rightTime = Date.parse(right.charttime ?? "");
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

function buildTimeline(records: VitalRecord[]): TimelinePoint[] {
  const buckets = new Map<string, TimelinePoint>();

  [...records]
    .sort((left, right) => {
      const leftTime = Date.parse(left.charttime ?? "");
      const rightTime = Date.parse(right.charttime ?? "");
      return (Number.isNaN(leftTime) ? 0 : leftTime) - (Number.isNaN(rightTime) ? 0 : rightTime);
    })
    .forEach((record, index) => {
      const bucketKey = record.charttime?.trim() || `record-${index}`;
      const point = buckets.get(bucketKey) ?? {
        key: bucketKey,
        displayTime: formatShortDate(record.charttime),
        heartRate: null,
        bloodPressure: null,
      };

      const value = getNumericMeasurement(record);
      if (isHeartRateLabel(record.label)) {
        point.heartRate = value;
      } else {
        point.bloodPressure = value;
      }

      buckets.set(bucketKey, point);
    });

  return [...buckets.values()];
}

function buildLinePath(
  points: TimelinePoint[],
  getValue: (point: TimelinePoint) => number | null,
  width: number,
  height: number,
  minValue: number,
  maxValue: number,
): string {
  const drawableWidth = width - 48;
  const drawableHeight = height - 28;
  const bottom = height - 18;
  const left = 24;
  const domain = Math.max(maxValue - minValue, 1);

  let path = "";

  points.forEach((point, index) => {
    const value = getValue(point);
    if (value === null) {
      return;
    }

    const ratio = points.length === 1 ? 0.5 : index / Math.max(points.length - 1, 1);
    const x = left + ratio * drawableWidth;
    const y = bottom - ((value - minValue) / domain) * drawableHeight;
    path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });

  return path;
}

function buildFocusTarget(focusEvidence: EvidenceItem | null): FocusTarget {
  if (!focusEvidence) {
    return {
      tab: null,
      key: null,
      anchorKey: null,
    };
  }

  if (focusEvidence.type === "lab" && isRecord(focusEvidence.content)) {
    return {
      tab: "labs",
      key: `lab-${buildMeasurementKey({
        itemid: readNumber(focusEvidence.content, "itemid"),
        label: readString(focusEvidence.content, "label"),
        charttime: readString(focusEvidence.content, "charttime"),
        valuenum: readNumber(focusEvidence.content, "valuenum"),
        value: readString(focusEvidence.content, "value"),
      })}`,
      anchorKey: "labs-anchor",
    };
  }

  if (focusEvidence.type === "vital" && isRecord(focusEvidence.content)) {
    return {
      tab: "vitals",
      key: `vital-${buildMeasurementKey({
        itemid: readNumber(focusEvidence.content, "itemid"),
        label: readString(focusEvidence.content, "label"),
        charttime: readString(focusEvidence.content, "charttime"),
        valuenum: readNumber(focusEvidence.content, "valuenum"),
        value: readString(focusEvidence.content, "value"),
      })}`,
      anchorKey: "vitals-anchor",
    };
  }

  if (focusEvidence.type === "diagnosis" && isRecord(focusEvidence.content)) {
    return {
      tab: null,
      key: `diagnosis-${buildDiagnosisKey(focusEvidence.content)}`,
      anchorKey: "diagnoses-anchor",
    };
  }

  return {
    tab: null,
    key: "patient-summary",
    anchorKey: "patient-summary",
  };
}

function scrollTargetIntoCard(target: HTMLElement | null, fallback: HTMLElement | null): void {
  const nextTarget = target ?? fallback;
  if (!nextTarget) {
    return;
  }

  const container = nextTarget.closest<HTMLElement>(".app-card-body");
  if (!container) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = nextTarget.getBoundingClientRect();
  const offsetTop = targetRect.top - containerRect.top;
  const nextScrollTop =
    container.scrollTop + offsetTop - container.clientHeight / 2 + targetRect.height / 2;

  container.scrollTo({
    top: Math.max(nextScrollTop, 0),
    behavior: "smooth",
  });
}

export function PatientDataCanvas({
  currentHadmId,
  patientData,
  patientLoading,
  patientError,
  vitals,
  labs,
  dataLoading,
  dataError,
  activeTab,
  onTabChange,
  focusEvidence,
  interactionEvidence,
}: PatientDataCanvasProps) {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(12);
  const diagnosisCount = patientData?.diagnoses.length ?? 0;
  const overview = patientData?.patient_overview ?? null;

  const mergedVitals = useMemo(
    () => mergeVitalRecords(vitals, interactionEvidence),
    [interactionEvidence, vitals],
  );
  const mergedLabs = useMemo(
    () => mergeLabRecords(labs, interactionEvidence),
    [interactionEvidence, labs],
  );
  const timeline = useMemo(() => buildTimeline(mergedVitals), [mergedVitals]);
  const visibleTimeline = useMemo(() => {
    if (zoomLevel === "all") {
      return timeline;
    }

    return timeline.slice(-zoomLevel);
  }, [timeline, zoomLevel]);
  const focusTarget = useMemo(() => buildFocusTarget(focusEvidence), [focusEvidence]);
  const highlightedKey = focusTarget.key;

  useEffect(() => {
    setZoomLevel(12);
  }, [currentHadmId]);

  useEffect(() => {
    if (!focusTarget.tab) {
      return;
    }

    if (focusTarget.tab !== activeTab) {
      onTabChange(focusTarget.tab);
    }

    if (focusTarget.tab === "vitals") {
      setZoomLevel("all");
    }
  }, [activeTab, focusTarget.tab, onTabChange]);

  useEffect(() => {
    if (!focusTarget.key && !focusTarget.anchorKey) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const target = focusTarget.key
        ? document.querySelector<HTMLElement>(`[data-canvas-key="${focusTarget.key}"]`)
        : null;
      const fallback = focusTarget.anchorKey
        ? document.querySelector<HTMLElement>(`[data-canvas-key="${focusTarget.anchorKey}"]`)
        : null;

      scrollTargetIntoCard(target, fallback);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeTab, focusTarget.anchorKey, focusTarget.key, mergedLabs, mergedVitals, patientData]);

  const latestHeartRate = mergedVitals.find((record) => isHeartRateLabel(record.label));
  const latestBloodPressure = mergedVitals.find((record) => !isHeartRateLabel(record.label));
  const abnormalLabCount = mergedLabs.filter((record) => Boolean(record.flag?.trim())).length;

  const chartValues = visibleTimeline.flatMap((point) =>
    [point.heartRate, point.bloodPressure].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    ),
  );
  const minChartValue = chartValues.length > 0 ? Math.min(...chartValues) - 6 : 0;
  const maxChartValue = chartValues.length > 0 ? Math.max(...chartValues) + 6 : 100;

  const heartRatePath = buildLinePath(
    visibleTimeline,
    (point) => point.heartRate,
    960,
    250,
    minChartValue,
    maxChartValue,
  );
  const bloodPressurePath = buildLinePath(
    visibleTimeline,
    (point) => point.bloodPressure,
    960,
    250,
    minChartValue,
    maxChartValue,
  );

  return (
    <section className="canvas-column">
      <AppCard
        className="canvas-summary-card"
        title="患者摘要"
        actions={
          <StatusBadge tone={patientData ? "success" : patientLoading ? "warning" : "neutral"}>
            {patientData ? "已加载" : patientLoading ? "加载中" : "等待中"}
          </StatusBadge>
        }
      >
        {patientLoading && (
          <EmptyState title="正在加载患者详情" description="请稍候。" />
        )}

        {!patientLoading && patientError && <div className="error-box">{patientError}</div>}

        {!patientLoading && !patientError && !patientData && (
          <EmptyState
            title="未加载患者"
            description="请先在上方选择一个入院 ID。"
          />
        )}

        {!patientLoading && !patientError && patientData && (
          <div className="panel-stack">
            <section className="canvas-hero" data-canvas-key="patient-summary">
              <div>
                <p className="canvas-hero-eyebrow">当前入院</p>
                <h3 className="canvas-hero-title">入院 {currentHadmId}</h3>
                <p className="canvas-hero-copy">
                  {formatGender(overview?.gender)} | {formatAge(overview?.age)} |{" "}
                  {formatValue(overview?.admission_type)}
                </p>
              </div>
              <div className="canvas-hero-meta">
                <StatusBadge tone="info">{diagnosisCount} 个诊断</StatusBadge>
                <StatusBadge tone="neutral">
                  {overview?.icu_stay_id ? "已关联 ICU" : "无 ICU 停留"}
                </StatusBadge>
              </div>
            </section>

            <div className="info-grid summary-grid">
              <InfoField label="患者 ID" value={overview?.subject_id} />
              <InfoField label="入院时间" value={formatShortDate(String(overview?.admittime ?? ""))} />
              <InfoField label="出院时间" value={formatShortDate(String(overview?.dischtime ?? ""))} />
              <InfoField label="入院来源" value={overview?.admission_location} />
            </div>

            <section className="content-section" data-canvas-key="diagnoses-anchor">
              <div className="section-heading">
                <h3 className="section-title">诊断</h3>
              </div>
              {patientData.diagnoses.length === 0 ? (
                <p className="section-empty">无诊断记录。</p>
              ) : (
                <div className="diagnosis-grid">
                  {patientData.diagnoses.map((diagnosis, index) => {
                    const key = buildDiagnosisKey(diagnosis);
                    const isHighlighted = highlightedKey === `diagnosis-${key}`;

                    return (
                      <article
                        key={`${key}-${index}`}
                        className={`diagnosis-card ${isHighlighted ? "diagnosis-card-highlighted" : ""}`}
                        data-canvas-key={`diagnosis-${key}`}
                      >
                        <strong className="diagnosis-card-code">
                          ICD {formatValue(diagnosis.icd_code)}
                        </strong>
                        <span className="diagnosis-card-copy">
                          版本 {formatValue(diagnosis.icd_version)} | 序列 {formatValue(diagnosis.seq_num)}
                        </span>
                        <p className="diagnosis-card-description">
                          {formatValue(diagnosis.short_title || diagnosis.long_title || diagnosis.title || "-")}
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </AppCard>

      <AppCard
        className="canvas-data-card"
        title="临床数据"
        actions={
          <div className="canvas-status-group">
            {dataLoading && <StatusBadge tone="warning">刷新中</StatusBadge>}
            {!dataLoading && (
              <StatusBadge tone="info">
                {mergedVitals.length + mergedLabs.length} 条记录
              </StatusBadge>
            )}
          </div>
        }
      >
        <div className="canvas-tab-list" role="tablist" aria-label="患者数据标签">
          {[
            { id: "vitals", label: "生命体征" },
            { id: "labs", label: "实验室结果" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`canvas-tab ${activeTab === tab.id ? "canvas-tab-active" : ""}`}
              type="button"
              onClick={() => onTabChange(tab.id as DataCanvasTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {dataError && <div className="error-box">{dataError}</div>}

        {activeTab === "vitals" && (
          <div className="canvas-panel" data-canvas-key="vitals-anchor">
            <div className="canvas-toolbar">
              <div className="canvas-toolbar-group">
                <span className="canvas-toolbar-label">时间窗口</span>
                {[6, 12, 24, "all"].map((level) => (
                  <button
                    key={String(level)}
                    className={`canvas-chip ${zoomLevel === level ? "canvas-chip-active" : ""}`}
                    type="button"
                    onClick={() => setZoomLevel(level as ZoomLevel)}
                  >
                    {level === "all" ? "全部" : `${level}`}
                  </button>
                ))}
              </div>
              <div className="canvas-toolbar-group">
                <StatusBadge tone="info">{mergedVitals.length} 条记录</StatusBadge>
              </div>
            </div>

            {mergedVitals.length === 0 ? (
              <EmptyState
                title="无生命体征记录"
                description="加载患者后将显示生命体征。"
              />
            ) : (
              <div className="panel-stack">
                <div className="chart-shell">
                  <svg
                    className="clinical-chart"
                    viewBox="0 0 960 250"
                    role="img"
                    aria-label="心率和血压趋势"
                  >
                    {[0.2, 0.5, 0.8].map((_, index) => (
                      <line
                        key={index}
                        x1="24"
                        x2="936"
                        y1={32 + index * 70}
                        y2={32 + index * 70}
                        className="chart-grid-line"
                      />
                    ))}
                    {heartRatePath && (
                      <path d={heartRatePath} className="chart-line chart-line-primary" />
                    )}
                    {bloodPressurePath && (
                      <path d={bloodPressurePath} className="chart-line chart-line-secondary" />
                    )}
                    {visibleTimeline.map((point, index) => {
                      const ratio =
                        visibleTimeline.length === 1
                          ? 0.5
                          : index / Math.max(visibleTimeline.length - 1, 1);
                      const x = 24 + ratio * (960 - 48);

                      return (
                        <text
                          key={point.key}
                          x={x}
                          y="242"
                          className="chart-axis-label"
                          textAnchor="middle"
                        >
                          {point.displayTime}
                        </text>
                      );
                    })}
                  </svg>
                </div>

                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="legend-swatch legend-swatch-primary" />
                    心率
                  </span>
                  <span className="legend-item">
                    <span className="legend-swatch legend-swatch-secondary" />
                    血压
                  </span>
                </div>

                <div className="summary-strip">
                  <div className="summary-tile">
                    <span className="summary-tile-label">最新心率</span>
                    <strong>{latestHeartRate ? buildDisplayMeasurement(latestHeartRate) : "--"}</strong>
                    <span className="summary-tile-copy">
                      {latestHeartRate ? formatShortDate(latestHeartRate.charttime) : "无记录"}
                    </span>
                  </div>
                  <div className="summary-tile">
                    <span className="summary-tile-label">最新血压</span>
                    <strong>
                      {latestBloodPressure ? buildDisplayMeasurement(latestBloodPressure) : "--"}
                    </strong>
                    <span className="summary-tile-copy">
                      {latestBloodPressure ? formatShortDate(latestBloodPressure.charttime) : "无记录"}
                    </span>
                  </div>
                </div>

                <div className="vitals-list">
                  {mergedVitals.slice(0, 8).map((record) => {
                    const key = buildMeasurementKey(record);
                    const isHighlighted = highlightedKey === `vital-${key}`;

                    return (
                      <article
                        key={key}
                        className={`vitals-row ${isHighlighted ? "vitals-row-highlighted" : ""}`}
                        data-canvas-key={`vital-${key}`}
                      >
                        <div>
                          <strong>{formatValue(record.label)}</strong>
                          <p className="vitals-row-copy">{formatShortDate(record.charttime)}</p>
                        </div>
                        <div className="vitals-row-value">
                          <strong>{buildDisplayMeasurement(record)}</strong>
                          {record.warning ? <StatusBadge tone="warning">已标记</StatusBadge> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "labs" && (
          <div className="canvas-panel" data-canvas-key="labs-anchor">
            <div className="canvas-toolbar">
              <div className="canvas-toolbar-group">
                <StatusBadge tone="info">{mergedLabs.length} 条实验室记录</StatusBadge>
                <StatusBadge tone={abnormalLabCount > 0 ? "warning" : "success"}>
                  {abnormalLabCount > 0 ? `${abnormalLabCount} 条已标记` : "无异常标记"}
                </StatusBadge>
              </div>
            </div>

            {mergedLabs.length === 0 ? (
              <EmptyState
                title="无实验室记录"
                description="加载患者后将显示实验室结果。"
              />
            ) : (
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>检查项目</th>
                      <th>时间</th>
                      <th>结果</th>
                      <th>标记</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedLabs.map((record) => {
                      const key = buildMeasurementKey(record);
                      const isHighlighted = highlightedKey === `lab-${key}`;
                      const isAbnormal = Boolean(record.flag?.trim());

                      return (
                        <tr
                          key={key}
                          className={[
                            isHighlighted ? "table-row-highlighted" : "",
                            isAbnormal ? "table-row-abnormal" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-canvas-key={`lab-${key}`}
                        >
                          <td>
                            <div className="table-primary-cell">
                              <strong>{formatValue(record.label)}</strong>
                            </div>
                          </td>
                          <td>{formatShortDate(record.charttime)}</td>
                          <td>{buildDisplayMeasurement(record)}</td>
                          <td>{record.flag?.trim() || "--"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </AppCard>
    </section>
  );
}
