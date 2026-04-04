import type { PatientOverviewResponse } from "../types";

interface PatientPanelProps {
  patient: PatientOverviewResponse | null;
  loading: boolean;
}

export function PatientPanel({ patient, loading }: PatientPanelProps) {
  return (
    <section className="panel panel--patient">
      <h2 className="panel__title">患者概览</h2>
      {loading && <p className="muted">加载中…</p>}
      {!loading && !patient && (
        <p className="muted">请输入 hadm_id 并点击「加载患者」。</p>
      )}
      {!loading && patient && (
        <div className="patient-body">
          <dl className="kv">
            <dt>hadm_id</dt>
            <dd>{patient.hadm_id}</dd>
            <dt>subject_id</dt>
            <dd>{patient.subject_id ?? "—"}</dd>
            <dt>性别</dt>
            <dd>{patient.gender ?? "—"}</dd>
            <dt>年龄 (anchor_age)</dt>
            <dd>{patient.anchor_age ?? "—"}</dd>
            <dt>入院时间</dt>
            <dd>{patient.admittime ?? "—"}</dd>
            <dt>出院时间</dt>
            <dd>{patient.dischtime ?? "—"}</dd>
          </dl>
          <h3 className="subhead">ICU 入住</h3>
          {patient.icu_stays.length === 0 ? (
            <p className="muted">无 ICU 记录</p>
          ) : (
            <ul className="list">
              {patient.icu_stays.map((s) => (
                <li key={s.stay_id ?? `${s.intime}-${s.outtime}`}>
                  stay_id: {s.stay_id ?? "—"} | intime: {s.intime ?? "—"} |
                  outtime: {s.outtime ?? "—"}
                  {s.los != null ? ` | los: ${s.los}` : ""}
                </li>
              ))}
            </ul>
          )}
          <h3 className="subhead">诊断 (ICD)</h3>
          {patient.diagnoses.length === 0 ? (
            <p className="muted">无诊断记录</p>
          ) : (
            <ul className="list list--compact">
              {patient.diagnoses.map((d, i) => (
                <li key={`${d.seq_num}-${d.icd_code}-${i}`}>
                  seq {d.seq_num ?? "—"} | {d.icd_code ?? "—"} (v
                  {d.icd_version ?? "—"})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
