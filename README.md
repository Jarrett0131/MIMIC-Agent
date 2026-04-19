# Clinical Data Agent Demo

## 1. Official Architecture

This repository now uses a single supported architecture:

```text
frontend
  -> agent-server
      -> data-service
          -> MIMIC-IV demo CSV
      -> docs/rag
      -> optional LLM
```

System roles:

- `data-service/` is the only clinical data backend and the source of truth for patient data.
- `agent-server/` is the orchestration and enhancement layer. It handles routing, rewrite, retrieval, answer composition, and streaming responses.
- `frontend/` is the user interaction layer. It should only talk to `agent-server/`.

Legacy note:

- The old `backend/` Python orchestration service is no longer part of the supported system and has been removed.

Architecture contract:

- `frontend/` must not call `data-service/` directly.
- `agent-server/` must not duplicate the data backend role of `data-service/`.
- `data-service/` must not own LLM orchestration, RAG composition, or chat workflow logic.
- Clinical data access should be implemented in `data-service/` first, then exposed through `agent-server/`.
- Knowledge explanations and retrieval assets belong under `docs/rag/` and are consumed by `agent-server/`.

For the full development boundary definition, see [docs/architecture.md](docs/architecture.md).

## 2. Project Structure

```text
frontend/       React UI for patient selection, Q&A, state flow, and evidence linking
agent-server/   Node.js orchestration layer for routing, rewrite, RAG, and streaming responses
data-service/   Python FastAPI data backend that reads the MIMIC demo data and exposes structured APIs
docs/rag/       Retrieval corpus and structured knowledge assets used by the agent layer
scripts/        One-command startup and smoke-test scripts
evaluation/     Offline evaluation and LLM_ON vs LLM_OFF comparison scripts
data/           MIMIC demo dataset
```

Recommended ownership:

- Add or change patient data APIs in `data-service/`.
- Add or change agent workflows, classification, RAG, and answer composition in `agent-server/`.
- Add or change UI, state, visual flow, and evidence display in `frontend/`.

## 3. Run The Project

1. Configure `.env`

```powershell
Copy-Item data-service/.env.example data-service/.env
Copy-Item agent-server/.env.example agent-server/.env
Copy-Item frontend/.env.example frontend/.env
```

- `data-service/.env`
  - `MIMIC_DATA_DIR=../data/mimic_demo`
- `agent-server/.env`
  - `PYTHON_SERVICE_URL=http://127.0.0.1:8000`
  - `LLM_API_KEY=` can be left empty; rewrite and answer enhancement will safely fall back
- `frontend/.env`
  - `VITE_AGENT_SERVER_URL=http://127.0.0.1:3001`

2. Start `data-service`

```powershell
pip install -r data-service/requirements.txt
python data-service/run.py
```

3. Start `agent-server`

```powershell
npm --prefix agent-server install
npm --prefix agent-server run dev
```

4. Start `frontend`

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

Default URLs:

```text
data-service  http://127.0.0.1:8000
agent-server  http://127.0.0.1:3001
frontend      http://localhost:5173
```

One-command start:

```powershell
./scripts/dev-start-all.ps1
```

Core verification:

```powershell
npm --prefix frontend run build
npm --prefix agent-server run build
./scripts/smoke-test.ps1
```

LLM_ON vs LLM_OFF comparison:

```powershell
./evaluation/scripts/run-llm-compare.ps1
```

## 4. Example Questions

- Structured: `patient overview for this admission`
- Structured: `latest glucose lab result`
- Structured: `latest pulse reading`
- Structured: `what are the diagnoses for this patient?`
- RAG: `what does pulse measure?`
- RAG: `what is charttime field?`
- RAG: `what is sepsis?`
- Follow-up: `What about blood pressure?`
- Follow-up: `And patient info?`
- Follow-up: `And what does AKI mean?`

## 5. Import External Clinical Data

The app now supports two import paths through the frontend or the proxy API:

- CSV tables: the practical path for external datasets split across `patients`, `diagnoses`, `labs`, and `vitals`.
- JSON bundle: the normalized path when your external data is already grouped by patient.

Available endpoints:

- Frontend: use the `Import External Data` card in the right sidebar.
- Agent server JSON proxy: `POST /imports/clinical-data`
- Agent server CSV proxy: `POST /imports/clinical-data/csv`
- Agent server Excel proxy: `POST /imports/clinical-data/excel`
- Agent server import history: `GET /imports/clinical-data`
- Agent server delete import: `DELETE /imports/clinical-data/{import_id}`
- Data-service JSON upstream: `POST /imports/clinical-data`
- Data-service CSV upstream: `POST /imports/clinical-data/csv`
- Data-service Excel upstream: `POST /imports/clinical-data/excel`
- Data-service import history: `GET /imports/clinical-data`
- Data-service delete import: `DELETE /imports/clinical-data/{import_id}`

### CSV Table Shape

Minimum requirement:

- `patients_csv` is required.
- `patients_csv` must include a `hadm_id` column.
- Optional tables must also include `hadm_id` and reference rows already present in `patients_csv`.

Example CSV import request:

```json
{
  "dataset_name": "external-icu-demo",
  "csv_bundle": {
    "patients_csv": "hadm_id,subject_id,gender,age,admittime\n900001,500001,F,67,2026-04-16T08:30:00Z",
    "diagnoses_csv": "hadm_id,seq_num,icd_code,icd_version\n900001,1,A41.9,10",
    "labs_csv": "hadm_id,itemid,label,charttime,value,valuenum,valueuom,flag\n900001,50813,Lactate,2026-04-16T09:00:00Z,3.2,3.2,mmol/L,abnormal",
    "vitals_csv": "hadm_id,itemid,label,charttime,value,valuenum,valueuom,warning\n900001,220045,Heart Rate,2026-04-16T09:05:00Z,112,112,bpm,1"
  }
}
```

Recognized `patients_csv` columns:

- `hadm_id` required
- optional: `subject_id`, `gender`, `age`, `admittime`, `dischtime`, `admission_type`, `admission_location`, `discharge_location`, `race`, `icu_stay_id`, `icu_intime`, `icu_outtime`

### Excel Workbook Shape

Excel imports accept a single `.xlsx` workbook encoded and sent through the proxy. The workbook should contain:

- required sheet: `patients`
- optional sheets: `diagnoses`, `labs`, `vitals`

Sheet matching is case-insensitive and ignores spaces, underscores, and hyphens, so `Patients`, `patient_overview`, `lab-events`, and similar names are accepted where appropriate.

Example Excel import request:

```json
{
  "dataset_name": "external-icu-demo",
  "excel_bundle": {
    "workbook_name": "external-icu-demo.xlsx",
    "workbook_base64": "<base64-xlsx-bytes>"
  }
}
```

### JSON Bundle Shape

Example JSON import request:

```json
{
  "dataset_name": "external-icu-demo",
  "bundle": {
    "metadata": {
      "name": "External ICU Demo",
      "source": "manual-import"
    },
    "patients": [
      {
        "hadm_id": 900001,
        "patient_overview": {
          "subject_id": 500001,
          "gender": "F",
          "age": 67,
          "admittime": "2026-04-16T08:30:00Z"
        },
        "diagnoses": [
          { "seq_num": 1, "icd_code": "A41.9", "icd_version": 10 }
        ],
        "labs": [
          {
            "label": "Lactate",
            "charttime": "2026-04-16T09:00:00Z",
            "value": "3.2",
            "valuenum": 3.2,
            "valueuom": "mmol/L"
          }
        ],
        "vitals": [
          {
            "label": "Heart Rate",
            "charttime": "2026-04-16T09:05:00Z",
            "value": "112",
            "valuenum": 112,
            "valueuom": "bpm"
          }
        ]
      }
    ]
  }
}
```

Imported bundles are persisted under `data-service/imports/clinical-data/`. After a successful import, the new `hadm_id` values appear in the existing patient picker and can be queried through the normal structured + agent flow.

Import management:

- The UI now shows import history in the same import card.
- Deleting an imported dataset removes the persisted import file and refreshes the patient picker.
- If the deleted dataset owned the currently selected imported patient, the app attempts to reload that `hadm_id` from any remaining source.
