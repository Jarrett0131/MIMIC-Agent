import { useState } from "react";
import { PatientPanel } from "./components/PatientPanel";
import { ChatPanel } from "./components/ChatPanel";
import { TracePanel } from "./components/TracePanel";
import { fetchPatientOverview } from "./api/patient";
import { ApiError } from "./api/client";
import type { AskResponse, PatientOverviewResponse } from "./types";

export default function App() {
  const [hadmInput, setHadmInput] = useState("");
  const [hadmId, setHadmId] = useState<number | null>(null);
  const [patient, setPatient] = useState<PatientOverviewResponse | null>(null);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);
  const [trace, setTrace] = useState<AskResponse | null>(null);

  async function handleLoadPatient() {
    setPatientError(null);
    const n = Number.parseInt(hadmInput.trim(), 10);
    if (Number.isNaN(n)) {
      setPatientError("请输入有效的整数 hadm_id。");
      setPatient(null);
      setHadmId(null);
      setTrace(null);
      return;
    }
    setPatientLoading(true);
    setPatient(null);
    setTrace(null);
    try {
      const data = await fetchPatientOverview(n);
      setPatient(data);
      setHadmId(n);
    } catch (err) {
      setPatient(null);
      setHadmId(null);
      if (err instanceof ApiError) {
        setPatientError(err.message);
      } else if (err instanceof Error) {
        setPatientError(err.message);
      } else {
        setPatientError("加载患者失败。");
      }
    } finally {
      setPatientLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">MIMIC-IV Demo · 患者级临床问答</h1>
        <div className="header__controls">
          <label className="label-inline" htmlFor="hadm">
            hadm_id
          </label>
          <input
            id="hadm"
            className="input"
            type="text"
            inputMode="numeric"
            value={hadmInput}
            onChange={(e) => setHadmInput(e.target.value)}
            placeholder="例如 20000032"
          />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleLoadPatient}
            disabled={patientLoading}
          >
            {patientLoading ? "加载中…" : "加载患者"}
          </button>
          {hadmId != null && (
            <span className="badge">当前: {hadmId}</span>
          )}
        </div>
        {patientError && (
          <div className="alert alert--error header__alert">{patientError}</div>
        )}
      </header>
      <main className="layout">
        <PatientPanel patient={patient} loading={patientLoading} />
        <ChatPanel hadm_id={hadmId} onTrace={setTrace} />
        <TracePanel trace={trace} />
      </main>
    </div>
  );
}
