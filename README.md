# MIMIC 临床数据智能代理系统

基于 [Mastra](https://mastra.ai)（TypeScript AI Agent 框架）构建的临床数据问答系统，使用 MIMIC-IV demo 数据集。用户用自然语言提问，一个 Mastra Agent 通过 **tool-calling** 自主选择工具去查询患者结构化数据或检索本地医学知识，并给出带证据的中文回答。

---

## 1. 系统架构

三层职责清晰，边界见 [docs/architecture.md](docs/architecture.md)：

```
┌────────────────────────────────────────────────────────────┐
│ frontend/  (React 18 + Vite, :5173)                          │
│  患者选择 · 聊天 · 流程可视化 · 证据高亮 · 数据导入 · debug 面板 │
└───────────────┬──────────────────────────────────────────────┘
                │ POST /ask  (JSON 或 NDJSON 流式)
                ▼
┌────────────────────────────────────────────────────────────┐
│ agent-server/  (Express + Mastra, TypeScript/ESM, :3001)     │
│                                                              │
│   routes/ask.ts ──► services/mastraAsk.ts                    │
│        └─ 把 /ask 契约(workflow/evidence/stream)适配到 Mastra   │
│   mastra/index.ts ── mimicAgent (LLM tool-calling)           │
│        ├─ getPatient        ┐                                │
│        ├─ getDiagnoses      │ 每个工具都包装现有的            │
│        ├─ getLabs           ├─ pythonClient → data-service    │
│        ├─ getVitals         ┘                                │
│        └─ retrieveKnowledge ── 本地 RAG (docs/rag)            │
│   model: DeepSeek / OpenAI 兼容 (复用 .env)                   │
│                                                              │
│   Mastra Studio (mastra dev) 独立跑在 :4111，用于本地调试      │
└───────────────┬──────────────────────────────────────────────┘
                │ axios (services/pythonClient.ts)
                ▼
┌────────────────────────────────────────────────────────────┐
│ data-service/  (Python / FastAPI + pandas, :8000)            │
│  加载 MIMIC-IV demo CSV · 患者/诊断/化验/体征查询 · 数据导入    │
└───────────────┬──────────────────────────────────────────────┘
                ▼
          data/  (MIMIC-IV demo CSV)
```

**调用边界（强约束）**：前端只调 `agent-server`；`agent-server` 调 `data-service` 拿结构化数据、读 `docs/rag/` 做检索；`data-service` 只读 `data/`。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18、Vite 5、TypeScript、react-virtuoso |
| Agent 层 | **Node.js 22 + TypeScript (ESM)**、Express 4、**Mastra `@mastra/core`**、Zod、tsx、Vitest |
| 数据层 | Python 3.12、FastAPI、Uvicorn、pandas、openpyxl |
| LLM | DeepSeek / 阿里云通义 / OpenAI —— 任意 OpenAI 兼容 endpoint，经 Mastra 的 `OpenAICompatibleConfig` 接入 |
| 数据 | MIMIC-IV Clinical Database Demo |

---

## 3. 项目结构

```
MIMIC-Agent/
├─ frontend/                 React 前端
├─ agent-server/             Express + Mastra Agent 层
│  ├─ src/
│  │  ├─ mastra/
│  │  │  ├─ index.ts         Mastra 实例 + mimicAgent 定义
│  │  │  └─ tools.ts         5 个 createTool（包装现有逻辑）
│  │  ├─ services/
│  │  │  ├─ mastraAsk.ts     /ask ↔ Mastra 适配器（流式、证据、工具轨迹）
│  │  │  ├─ pythonClient.ts  data-service HTTP 客户端（重试/错误归一）
│  │  │  └─ llmClient.ts     OpenAI 兼容客户端（RAG 查询归一化仍用）
│  │  ├─ rag/                本地 RAG：检索、重排、embedding 缓存
│  │  ├─ routes/
│  │  │  ├─ ask.ts           /ask（流式 + 非流式）
│  │  │  └─ rest.ts          patient/patients/diagnoses/labs/vitals/imports 透传
│  │  ├─ config.ts           env 配置 + LLM prompt 场景
│  │  ├─ logging.ts          结构化日志 + 请求上下文 + ask 审计
│  │  ├─ errors.ts           AgentError + 错误响应构造
│  │  ├─ types.ts            全部共享类型
│  │  ├─ utils.ts            通用工具函数
│  │  ├─ app.ts / server.ts  Express 装配与启动
│  └─ tests/                 Vitest（RAG、路由、LLM 客户端）
├─ data-service/             Python/FastAPI 数据层
├─ docs/
│  ├─ architecture.md        架构边界定义
│  └─ rag/                   本地医学知识 JSON 语料
├─ scripts/                  一键启动 / 冒烟脚本 (PowerShell)
└─ data/                     MIMIC-IV demo CSV
```

---

## 4. Agent 工作原理

`/ask` 请求进入 [routes/ask.ts](agent-server/src/routes/ask.ts)，由 [services/mastraAsk.ts](agent-server/src/services/mastraAsk.ts) 驱动 Mastra 的 `mimicAgent`：

1. 历史对话 + 当前问题（含 `hadm_id`）交给 Agent，**LLM 通过 tool-calling 自主决定调用哪个（或哪几个）工具**。
2. Agent 以流式（`agent.stream().fullStream`）产出 `tool-call` / `tool-result` / `text-delta` 事件，适配器把它们翻译成前端已有的协议：
   - `workflow`（classifying → tool_running → answering → done）
   - `answer_delta`（逐字流式回答）
   - `meta` / `complete`（证据 evidence、工具轨迹 tool_trace、建议 suggestions、诊断 diagnostics）
3. 每个工具的 `execute` 内部**直接调用原有的 `pythonClient` 函数**，HTTP 边界与 Python 数据层完全不变。

### 五个工具（[mastra/tools.ts](agent-server/src/mastra/tools.ts)）

| 工具 | 用途 | 后端 |
|---|---|---|
| `get-patient` | 患者概况：人口学、入出院、ICU 时间、诊断 | `data-service /patient` |
| `get-diagnoses` | 诊断列表（ICD 编码/版本/序号） | `data-service /diagnoses` |
| `get-labs` | 最近化验（keyword 为英文项名，如 glucose） | `data-service /labs/recent` |
| `get-vitals` | 最近生命体征（keyword 为英文名，如 heart rate） | `data-service /vitals/recent` |
| `retrieve-knowledge` | 解释术语/指标/字段（本地 RAG） | `docs/rag/` |

> 中英文映射（如"血糖"→`glucose`、"心率"→`heart rate`）由 Agent 在选工具时完成。

---

## 5. 本地部署

### 5.1 前置要求

- **Node.js ≥ 22.13**（Mastra 硬性要求）。推荐用 nvm-windows：
  ```powershell
  nvm install 22.13.0
  nvm use 22.13.0
  ```
- Python ≥ 3.10（建议 3.12），用 `py -3` 启动器。
- 一个 OpenAI 兼容的 LLM API Key（DeepSeek / 通义 / OpenAI 均可）。

### 5.2 环境配置

**agent-server/.env**（从 `.env.example` 复制后填写）：

```dotenv
PORT=3001
PYTHON_SERVICE_URL=http://localhost:8000

# LLM —— Agent 用它做 tool-calling 与回答
LLM_ENABLED=true
LLM_PROVIDER=deepseek                       # deepseek | aliyun | openai
LLM_API_KEY=sk-xxxxxxxx                      # ← 填你的真实 key
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com

# 本地 RAG 语料（Mastra 打包运行时用绝对路径最稳妥）
RAG_DOCS_DIR=D:/MIMIC-Agent/docs/rag
```

**frontend/.env**：`VITE_AGENT_SERVER_URL=http://localhost:3001`

### 5.3 安装依赖

```powershell
# 数据层
cd data-service
py -3 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# Agent 层
cd ../agent-server
npm install

# 前端
cd ../frontend
npm install
```

### 5.4 启动

三个服务分别启动（各自独立进程）：

```powershell
# 1) data-service (:8000)
cd data-service; ./.venv/Scripts/python.exe run.py

# 2) agent-server (:3001)  —— 前端对接的入口
cd agent-server; npm run dev

# 3) frontend (:5173)
cd frontend; npm run dev
```

打开 http://localhost:5173 即可使用。也可用一键脚本：

```powershell
./scripts/dev-start-all.ps1
```

### 5.5 Mastra Studio（本地调试）

在 `agent-server` 目录另起一个终端：

```powershell
npm run studio        # = mastra dev，Studio 在 http://localhost:4111
```

Studio 里可以：直接与 `mimicAgent` 对话、单独执行某个工具（Tool Playground，无需 LLM）、查看每次 tool-call 的输入输出与轨迹。也可用 CLI 自测：

```powershell
mastra api --url http://localhost:4111 agent list
mastra api --url http://localhost:4111 agent run mimic-agent '{"messages":"这个患者的基本信息？hadm_id 20044587"}'
```

---

## 6. API 契约

`POST /ask`（前端使用）：

```jsonc
// 请求
{ "hadm_id": 20044587, "question": "最近的血糖结果是多少？", "stream": true,
  "context": { "chat_history": [ /* 最近若干轮 */ ] } }

// 流式响应 (application/x-ndjson，每行一个事件)
{"type":"workflow","stage":"tool_running","workflow_state":[...]}
{"type":"answer_delta","delta":"最新","answer":"最新"}
{"type":"meta","response":{ /* evidence, tool_trace, suggestions, diagnostics */ }}
{"type":"complete","response":{ /* 完整 AskResponse */ }}
```

其余透传接口见 [routes/rest.ts](agent-server/src/routes/rest.ts)：`/patient/:hadm_id`、`/patients/ids`、`/diagnoses/:hadm_id`、`/labs/recent`、`/vitals/recent`、`/imports/clinical-data*`。

---

## 7. 示例问题

结构化查询：`这个患者的基本信息？`、`最近一次血糖是多少？`、`最近的心率如何？`、`有哪些诊断？`

知识解释：`glucose 代表什么？`、`charttime 是什么字段？`、`什么是脓毒症？`

上下文追问：`那血压呢？`、`这个指标是什么意思？`

---

## 8. 外部临床数据导入

支持通过前端或 API 导入自定义患者数据（JSON / CSV / Excel），导入后新 `hadm_id` 即可用于查询与问答。端点、CSV 表结构、Excel 工作簿结构、JSON Bundle 结构见 [routes/rest.ts](agent-server/src/routes/rest.ts) 与 data-service `imports` 实现。

CSV 最低要求：`patients_csv` 必填且含 `hadm_id`；可选表（diagnoses/labs/vitals）也需含 `hadm_id` 且只能引用已存在的患者。JSON Bundle 示例：

```json
{
  "dataset_name": "external-icu-demo",
  "bundle": {
    "patients": [
      {
        "hadm_id": 900001,
        "patient_overview": { "subject_id": 500001, "gender": "F", "age": 67, "admittime": "2026-04-16T08:30:00Z" },
        "diagnoses": [ { "seq_num": 1, "icd_code": "A41.9", "icd_version": 10 } ],
        "labs": [ { "label": "Lactate", "charttime": "2026-04-16T09:00:00Z", "valuenum": 3.2, "valueuom": "mmol/L" } ],
        "vitals": [ { "label": "Heart Rate", "charttime": "2026-04-16T09:05:00Z", "valuenum": 112, "valueuom": "bpm" } ]
      }
    ]
  }
}
```

---

## 9. 验证与测试

```powershell
cd agent-server
npm run typecheck     # tsc --noEmit，全绿
npm test              # vitest（RAG、路由、LLM 客户端）
```

冒烟验证（需三服务已启动）：`./scripts/smoke-test.ps1`

---

## 10. 开发注意事项

- 前端只能调用 `agent-server`，不能直接访问 `data-service` 或 `data/`。
- **新增一个 Agent 能力 = 新增一个工具**：在 [mastra/tools.ts](agent-server/src/mastra/tools.ts) 里 `createTool` 包装（通常复用/新增 `pythonClient` 调用），再在 [mastra/index.ts](agent-server/src/mastra/index.ts) 的 `mimicAgent.tools` 注册，并在 `instructions` 里说明何时使用——LLM 会按语义自行选用。
- 新增患者结构化数据：先在 `data-service` 加端点，再在 agent-server 加工具，最后经 `/ask` 暴露给 UI。
- 新增知识检索内容：更新 `docs/rag/` 的 JSON 语料，必要时调整 `src/rag/` 检索规则。
- 写 Mastra 代码前先核对**当前安装版本**的真实 API：项目根 `.mcp.json` 已配置 Mastra 官方文档 MCP 服务器；也可直接读 `node_modules/@mastra/core` 的类型定义。
- Node 必须 ≥ 22.13，否则 Mastra 安装/Studio 会报 `EBADENGINE`。
- 后续可演进方向：接入 Mastra `Memory`（替代前端塞 `chat_history`，做持久化会话）、用 `Workflow` 编排确定性多步、用 `scorers` 做评估、接 Mastra observability/OTel。
- 临床回答仅用于数据探索与演示，不能替代专业医疗建议。

更多架构边界见 [docs/architecture.md](docs/architecture.md)。
