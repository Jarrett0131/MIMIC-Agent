# MIMIC 临床数据智能代理系统

## 项目简介

MIMIC-Agent 是一个基于 MIMIC-IV 临床数据集的智能问答系统。用户可以通过自然语言查询患者信息、实验室检查结果、诊断记录等临床数据，系统通过多层次的处理流程（包括查询理解、检索增强、LLM 增强等）为用户提供准确的答案并关联相关证据。

该系统采用前后端分离的架构设计，通过前端、代理服务、数据服务三层协作，确保数据安全、逻辑清晰、易于维护和扩展。

## 技术栈

**前端层**：React + TypeScript + Vite，负责用户界面和交互体验。

**代理层**：Node.js + Express + TypeScript，提供请求路由、查询改写、检索增强、LLM 集成等核心处理逻辑。

**数据层**：Python + FastAPI，作为唯一的临床数据源，负责 MIMIC 数据的加载、查询和 API 暴露。

**检索资源**：结构化的医学知识库和诊断解释，存储在 `docs/rag/` 目录下。

**测试工具**：Vitest（前后端单元测试）、Supertest（API 集成测试）。

## 项目架构

系统采用三层架构设计，数据流向清晰且单向：

```
前端 (React UI)
    ↓
代理服务 (Node.js 编排层)
    ├→ 数据服务 (Python FastAPI)
    │   └→ MIMIC 数据集
    └→ 检索资源库 (docs/rag/)
        └→ 可选 LLM 增强
```

**前端 (frontend/)**：提供患者选择、问答界面、状态管理、证据展示等交互功能。只与代理服务通信。

**代理服务 (agent-server/)**：核心编排层，负责请求验证、查询改写、分类路由、RAG 检索、LLM 增强和流式响应。从数据服务获取患者信息，从检索资源获取医学知识。

**数据服务 (data-service/)**：唯一的临床数据源，通过 pandas 加载 MIMIC CSV 文件并暴露结构化 API 端点。仅负责数据查询，不涉及 LLM 编排或 RAG 逻辑。

**检索资源 (docs/rag/)**：包含诊断解释、实验室项目说明、医学术语等结构化知识，由代理服务在回答生成时引用。

## 如何部署

### 前置要求

- Python 3.8 以上版本
- Node.js 16 以上版本
- npm 或 yarn

### 1. 环境配置

复制各模块的示例配置文件：

```powershell
Copy-Item data-service/.env.example data-service/.env
Copy-Item agent-server/.env.example agent-server/.env
Copy-Item frontend/.env.example frontend/.env
```

编辑各 `.env` 文件设置必要参数：

**data-service/.env** - 数据服务配置
```
MIMIC_DATA_DIR=../data/mimic_demo
```

**agent-server/.env** - 代理服务配置
```
PYTHON_SERVICE_URL=http://127.0.0.1:8000
LLM_API_KEY=your-api-key-here
```

**frontend/.env** - 前端配置
```
VITE_AGENT_SERVER_URL=http://127.0.0.1:3001
```

### 2. 安装依赖并启动服务

**启动数据服务**（Python FastAPI）

```powershell
pip install -r data-service/requirements.txt
python data-service/run.py
```

服务将运行在 `http://127.0.0.1:8000`

**启动代理服务**（Node.js 应用）

```powershell
npm --prefix agent-server install
npm --prefix agent-server run dev
```

服务将运行在 `http://127.0.0.1:3001`

**启动前端应用**（React 应用）

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

应用将运行在 `http://localhost:5173`

### 3. 验证部署

所有服务启动后，打开浏览器访问 `http://localhost:5173`，选择患者并尝试提问。系统应能正确返回患者数据和答案。

## 注意事项

**数据隔离**：前端只能调用代理服务，不能直接访问数据服务或原始数据文件，确保数据安全和统一的业务逻辑控制。

**环境变量**：确保三个服务的环境变量配置正确对应。`LLM_API_KEY` 若未配置，系统会安全降级到无 LLM 增强的模式，继续提供基础查询和检索功能。

**依赖管理**：代理服务和前端使用 npm，数据服务使用 pip。若遇到依赖冲突，建议删除 `node_modules` 或 `venv` 后重新安装。

**检索资源**：`docs/rag/` 下的 JSON 文件包含医学知识库。若需要更新诊断解释或实验室项目说明，请修改对应的 JSON 文件，代理服务无需重启即可生效。

**日志输出**：代理服务和数据服务均提供详细的请求日志。开发时建议在终端中实时观察日志，快速定位问题。

**测试**：运行 `npm test` 执行前后端测试套件。若部分测试失败，请检查环境配置和数据文件完整性。

**性能优化**：MIMIC 数据集较大，初次查询可能需要几秒钟。建议在生产环境中考虑添加数据缓存或索引以加速查询。

详细的架构定义和开发边界说明，请参阅 [docs/architecture.md](docs/architecture.md)。

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
