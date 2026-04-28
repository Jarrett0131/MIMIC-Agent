# MIMIC 临床数据智能代理系统

## 1. 项目简介

MIMIC-Agent 是一个面向 MIMIC-IV 临床数据的智能问答系统。用户在前端选择一次住院记录后，可以用自然语言查询患者概况、诊断、化验结果、生命体征，也可以追问“这个字段是什么意思”“AKI 是什么”“pulse 测量什么”等医学知识类问题。

系统采用前端、代理服务、数据服务三层架构：

```text
frontend
  -> agent-server
      -> data-service
          -> data/mimic_demo
      -> docs/rag
      -> optional LLM
```

这套边界是项目的核心设计：前端只负责交互和展示；`agent-server` 负责编排、分类、RAG、LLM 增强和流式响应；`data-service` 是唯一的临床结构化数据源，专注于 MIMIC CSV 与外部导入数据的读取、清洗和查询。

## 2. 技术栈

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 前端 | React 18、TypeScript、Vite、Vitest、Testing Library | 患者选择、数据看板、问答面板、证据联动、外部数据导入 |
| 代理服务 | Node.js、Express、TypeScript、Axios、Vitest、Supertest | `/ask` 编排、工具路由、查询改写、RAG 检索、LLM 调用、NDJSON 流式输出 |
| 数据服务 | Python、FastAPI、pandas、pydantic、openpyxl、pytest | MIMIC demo 数据加载、患者/诊断/化验/生命体征 API、CSV/Excel/JSON 导入 |
| 知识库 | JSON 文档 | `docs/rag/` 下维护医学术语、实验室项目、MIMIC 字段、诊断解释 |
| 评估 | Vitest、PowerShell、Node 脚本 | Phase 3 评估集、LLM_ON/LLM_OFF 对比、冒烟测试 |

## 3. 项目结构

```text
MIMIC-Agent/
├─ README.md
├─ package.json                    # 工作区级测试入口
├─ scripts/
│  ├─ dev-start-all.ps1             # 一键启动 data-service、agent-server、frontend
│  └─ smoke-test.ps1                # 核心接口冒烟验证
├─ docs/
│  ├─ architecture.md               # 三层架构边界与目录契约
│  ├─ phase3_evaluation.md          # 阶段评估说明
│  └─ rag/
│     ├─ medical_terms.json         # 医学术语解释
│     ├─ lab_item_explanations.json # 实验室项目解释
│     ├─ mimic_field_dictionary.json# MIMIC 字段字典
│     └─ diagnosis_explanations.json# 诊断解释
├─ data/
│  └─ mimic_demo/                   # MIMIC-IV demo CSV 数据
├─ data-service/
│  ├─ run.py                        # FastAPI 启动入口
│  ├─ requirements.txt
│  ├─ imports/clinical-data/        # 外部导入数据的持久化目录
│  ├─ app/
│  │  ├─ main.py                    # FastAPI app 与路由注册
│  │  ├─ config.py                  # 数据目录、CORS、导入目录配置
│  │  ├─ data_loader.py             # pandas 读取 MIMIC CSV
│  │  ├─ schemas.py                 # pydantic 请求/响应模型
│  │  ├─ api/                       # FastAPI 路由
│  │  │  ├─ patient.py              # 单个患者概况
│  │  │  ├─ patients.py             # 患者 ID 列表
│  │  │  ├─ diagnoses.py            # 诊断查询
│  │  │  ├─ labs.py                 # 化验查询
│  │  │  ├─ vitals.py               # 生命体征查询
│  │  │  └─ imports.py              # 外部临床数据导入/历史/删除
│  │  └─ services/
│  │     ├─ patient_service.py
│  │     ├─ diagnosis_service.py
│  │     ├─ lab_service.py
│  │     ├─ vital_service.py
│  │     └─ import_service.py       # CSV/Excel/JSON 归一化、校验、持久化
│  └─ tests/
├─ agent-server/
│  ├─ src/
│  │  ├─ server.ts                  # Node 服务入口
│  │  ├─ app.ts                     # Express app、CORS、路由注册
│  │  ├─ routes/
│  │  │  ├─ ask.ts                  # 问答 API，支持普通 JSON 与 NDJSON streaming
│  │  │  ├─ imports.ts              # 外部数据导入代理
│  │  │  ├─ patient.ts / patients.ts
│  │  │  ├─ labs.ts / vitals.ts / diagnoses.ts
│  │  ├─ services/
│  │  │  ├─ askPipeline.ts          # 问答主流程：解析、改写、分类、工具、生成、诊断
│  │  │  ├─ classifier.ts           # 规则分类：结构化问题或知识类问题
│  │  │  ├─ router.ts               # 问题类型到工具注册表的路由
│  │  │  ├─ generator.ts            # 答案、证据、answer_links 组装
│  │  │  ├─ pythonClient.ts         # data-service HTTP 客户端、超时、重试、错误封装
│  │  │  └─ llmClient.ts            # LLM 调用、流式输出、预算/回退诊断
│  │  ├─ agent/
│  │  │  ├─ toolRegistry.ts         # fetchPatient/fetchLabs/fetchVitals/RAG 工具定义
│  │  │  ├─ withToolTrace.ts        # 工具调用 trace
│  │  │  ├─ rag/                    # 混合检索、query normalization、可选 rerank
│  │  │  └─ enhancement/            # 查询改写、答案增强
│  │  ├─ config/                    # 环境配置、问题规则、LLM 场景
│  │  ├─ evaluation/                # 评估运行器与类型
│  │  ├─ logging/                   # request context、结构化日志、ask log
│  │  └─ types/
│  └─ tests/
├─ frontend/
│  ├─ src/
│  │  ├─ App.tsx                    # 页面骨架、患者选择、问答、导入面板整合
│  │  ├─ api/                       # ask、patient、dashboard、imports HTTP 客户端
│  │  ├─ components/
│  │  │  ├─ DashboardHeader.tsx
│  │  │  ├─ PatientDataCanvas.tsx   # 患者数据、化验、生命体征看板
│  │  │  ├─ ChatPanel.tsx           # 问答输入、流式答案、建议问题、调试信息
│  │  │  ├─ LinkedAnswer.tsx        # 答案片段与证据联动
│  │  │  └─ ExternalDataImportPanel.tsx
│  │  ├─ hooks/
│  │  │  ├─ useAskSession.ts        # AbortController、NDJSON streaming、状态更新
│  │  │  ├─ usePatientLoader.ts
│  │  │  ├─ useDashboardData.ts
│  │  │  ├─ useClinicalImports.ts
│  │  │  └─ useDebugRequests.ts
│  │  ├─ store/agentReducer.ts      # 前端问答与患者状态机
│  │  └─ types/
│  └─ tests/
└─ evaluation/
   ├─ datasets/phase3_evalset.json
   └─ scripts/
      ├─ run-phase3-eval.ps1 / .js
      └─ run-llm-compare.ps1 / .js
```

## 4. 核心功能实现

### 4.1 患者数据看板

前端通过 `usePatientOptions` 获取可选 `hadm_id`，通过 `usePatientLoader` 加载患者概况，再由 `useDashboardData` 并行获取化验和生命体征数据。`PatientDataCanvas` 将患者概况、最新指标、异常标记和证据焦点集中展示。

实现思路是让前端只访问 `agent-server`，不直接访问 Python 服务或 CSV 文件。这样患者数据来源、错误处理、重试和跨域配置都集中在代理层，后续替换数据源时不需要改动 UI 调用边界。

### 4.2 自然语言问答流程

问答入口是 `agent-server/src/routes/ask.ts`。该路由支持两种返回模式：

- 普通 JSON：一次性返回完整 `AskResponse`。
- NDJSON streaming：按行返回 `workflow`、`meta`、`answer_delta`、`complete` 事件，前端可以边生成边渲染。

主流程在 `agent-server/src/services/askPipeline.ts`：

1. `parseAskRequest` 校验 `hadm_id`、`question` 和对话上下文。
2. `rewriteQuery` 根据最近对话和 `last_question_type` 处理追问，例如 “What about blood pressure?”。
3. `classifyQuestion` 用规则判断结构化查询或知识类查询。
4. `routeQuestion` 从工具注册表选择 `fetchPatient`、`fetchDiagnoses`、`fetchRecentLabs`、`fetchRecentVitals` 或 `retrieveKnowledge`。
5. `withToolTrace` 包装工具调用，记录输入、状态、结果数量和错误。
6. `generateAnswer` 生成中文答案、证据列表、限制说明和答案片段链接。
7. `enhanceAnswer` 在可用时调用 LLM 做回答增强，不可用时保留规则答案。
8. 返回 `diagnostics`，包含改写、分类、RAG、LLM 调用、预算、fallback 等可观测信息。

这个流程的重点是“可降级”：即使没有 LLM API Key，系统仍能通过结构化工具和本地 RAG 返回可解释答案。

### 4.3 结构化工具路由

`agent-server/src/agent/toolRegistry.ts` 将问题类型映射为具体工具：

- `patient_info` -> `fetchPatient`
- `diagnosis_query` -> `fetchDiagnoses`
- `lab_query` -> `fetchRecentLabs`
- `vital_query` -> `fetchRecentVitals`
- `term_explanation` / `metric_explanation` / `field_explanation` / `knowledge_query` -> `retrieveKnowledge`

化验和生命体征查询并不是把用户原句直接传给 Python，而是先用关键词规则抽取标准 keyword。例如 glucose、lactate、creatinine、heart rate、blood pressure、spo2 等。这样 Python 数据服务只需要稳定处理结构化参数，语义判断留在代理层完成。

### 4.4 RAG 检索增强

RAG 资源存放在 `docs/rag/`。`agent-server/src/agent/rag/retriever.ts` 会加载四类 JSON 语料并建立内存索引：

- 标题、别名、关键词、正文 token。
- 中英文同义概念，例如 glucose/血糖、pulse/heart rate/心率。
- category hint，例如 field、metric、term、diagnosis。
- domain hint，例如 lab、vital、patient、diagnosis。

检索采用混合打分：精确标题、别名命中、关键词短语、token overlap、概念命中、路由类别加权、领域提示共同决定排序。命中后会从正文中挑选与问题最相关的句子作为 chunk。配置开启实验能力时，还可以通过 embedding cache 和 rerank 对候选结果重新排序。

结构化查询也会尝试附加 RAG 解释。例如用户问 “latest glucose lab result”，系统先返回该患者最新血糖结果，再在 `rag_enhancement` 中补充 glucose 的医学解释，并把对应知识条目作为证据。

### 4.5 LLM 增强与回退

LLM 不是系统硬依赖。`llmClient.ts` 负责可用性判断、调用记录、流式文本、预算统计和 fallback provider 诊断。`generator.ts` 先生成规则答案；如果结构化数据为空但 LLM 可用，会生成通用医学补充，并明确提示“本地患者数据缺失”。如果 LLM 不可用，则返回规则 fallback 文案。

这种实现避免把所有回答质量都押在模型上：患者数据答案以结构化证据为主，LLM 只负责润色、解释或无数据时的补充。

### 4.6 答案证据联动

`generator.ts` 会为患者概况、诊断、化验、生命体征、RAG 文档生成 `evidence`。对于化验和生命体征类答案，还会生成 `answer_links`，标记答案中的指标名、数值、时间分别对应哪条证据字段。

前端的 `LinkedAnswer` 和 `PatientDataCanvas` 使用这些链接实现悬停/点击联动：用户在答案中指向 “Glucose”“116 mg/dL”“charttime” 时，右侧或主看板可以定位到对应证据。实现上不是靠前端猜文本，而是由后端生成稳定的 start/end、evidence_index 和 field。

### 4.7 外部临床数据导入

系统支持从 UI 或 API 导入外部临床数据，入口包括：

- JSON Bundle：`POST /imports/clinical-data`
- CSV 表格：`POST /imports/clinical-data/csv`
- Excel 工作簿：`POST /imports/clinical-data/excel`
- 导入历史：`GET /imports/clinical-data`
- 删除导入：`DELETE /imports/clinical-data/{import_id}`

具体实现位于 `data-service/app/services/import_service.py`：

1. CSV/Excel 都会先归一化为内部 JSON Bundle。
2. `patients` 是必需表，且必须包含正整数 `hadm_id`。
3. `diagnoses`、`labs`、`vitals` 必须引用已存在于 patients 表中的 `hadm_id`。
4. 字段会统一做 int、float、bool、datetime/string 归一化。
5. 导入结果持久化到 `data-service/imports/clinical-data/`。
6. 服务启动或首次访问时会加载已持久化的导入文件，并让新 `hadm_id` 出现在患者选择器中。

Excel 的 sheet 名称做了容错匹配，会忽略大小写、空格、下划线和连字符，所以 `Patients`、`patient_overview`、`lab-events` 等命名可以被识别到对应逻辑表。

### 4.8 调试、日志与评估

代理服务在请求生命周期中记录结构化日志：请求开始、分类结果、工具执行、RAG 失败、请求完成或失败。`askLogger` 会保存问答请求摘要，前端 `useDebugRequests` 也会展示问题类型、工具名、路由类型、增强信息和 diagnostics。

评估脚本位于 `evaluation/scripts/`。`run-phase3-eval` 使用固定评估集验证路由、答案和诊断输出；`run-llm-compare` 用于比较 LLM_ON 和 LLM_OFF 的行为差异，帮助确认 LLM 增强不会破坏基础结构化能力。

## 5. 项目亮点

### 5.1 三层职责清晰，避免数据逻辑散落

项目明确规定 `frontend -> agent-server -> data-service` 的调用方向。前端不碰 MIMIC CSV，数据服务不碰 LLM 和 RAG，代理服务不复制 pandas 查询逻辑。这个边界让每层可以独立测试和替换，也降低了临床数据项目常见的“UI、编排、数据清洗混在一起”的维护成本。

### 5.2 结构化数据优先，LLM 可插拔

患者答案不是由 LLM 直接“猜”出来，而是先通过工具获取真实记录，再把 `evidence` 和 `tool_trace` 返回给前端。LLM 只作为可选增强，因此没有 API Key 时仍能工作；有 LLM 时也能通过 diagnostics 看到调用次数、token 预算、fallback 和错误状态。

### 5.3 RAG 与结构化查询互相补充

系统不是单独做一个知识库问答，而是把 RAG 作为结构化答案的补充能力。问最新化验时能返回真实数值，也能解释指标含义；问字段或术语时则直接走本地知识库。这种组合更符合临床数据探索场景。

### 5.4 流式响应体验完整

`/ask` 的 NDJSON 协议拆分了 workflow、meta、answer_delta 和 complete，前端 `useAskSession` 用 `AbortController` 支持取消当前回答。用户可以看到“分类中、工具运行、回答中”的阶段变化，也能在长回答生成时即时收到文本。

### 5.5 外部数据导入形成闭环

导入功能覆盖 JSON、CSV、Excel 三种常见数据形态，并支持历史记录和删除。导入后数据会进入同一套患者选择、结构化查询和问答流程，不需要为外部数据单独写一套 UI 或 API。

### 5.6 可测试、可评估、可观测

仓库包含前端组件测试、代理服务路由/分类/RAG/LLM/评估测试、Python 导入服务测试、冒烟脚本和评估脚本。配合 `diagnostics` 和结构化日志，问题可以从 UI、代理、Python 数据服务三个层面追踪。

## 6. 实现难点与解决思路

### 6.1 自然语言问题如何稳定映射到结构化工具

难点在于用户会混合使用中英文、缩写和追问，例如 “latest pulse reading”“What about blood pressure?”。如果直接把问题传给数据服务，Python 层会承担过多语义判断。

解决思路是把语义路由集中在代理层：

- `questionRules.ts` 维护问题类型规则。
- `classifier.ts` 先判断解释意图、字段意图、指标意图，再回落到结构化规则或通用知识查询。
- `toolRegistry.ts` 对 lab/vital 做关键词抽取，统一成 Python 能处理的 keyword。
- `askPipeline.ts` 在分类失败但发现上下文追问时，用上一轮 `last_question_type` 作为补救。

这样做的结果是：数据服务保持简单稳定，代理层可以持续迭代语义规则。

### 6.2 追问上下文容易误判

追问通常缺少完整主语，例如 “And patient info?” 或 “那这个指标呢？”。系统需要结合上一轮问题类型，但不能把所有短句都强行归到上一轮。

当前实现把上下文限制在最近最多 6 轮，并只在分类失败且问题命中追问模式时使用 `last_question_type`。同时 `rewriteQuery` 会返回 `guard_applied` 和 `guard_reason`，让 diagnostics 能解释为什么改写或为什么没有改写。

### 6.3 RAG 命中质量与可解释性平衡

医学术语存在缩写、同义词和中英文混写，只靠简单字符串匹配容易漏召回；完全依赖 embedding 又会增加部署门槛和不可控因素。

项目采用可解释的混合检索作为默认方案：标题、别名、关键词、概念规则、领域 hint 都能在 `score_breakdown` 中体现。embedding rerank 作为实验能力可选开启。这样默认环境零外部依赖，同时保留后续提升召回质量的空间。

### 6.4 流式输出与最终响应一致性

流式接口要同时满足“尽快展示文本”和“最终响应包含完整证据、诊断、建议问题”。如果先流文本再补元数据，前端很难做证据联动；如果等完整结果再返回，又失去流式体验。

当前做法是在 pipeline 产生 workflow 时先发阶段事件；生成答案前后发送 `meta`；随后逐段发送 `answer_delta`；最后用 `complete` 返回完整 `AskResponse`。前端在 `ASK_STREAM_META` 时先建立响应框架，在 delta 到达时追加文本，在 complete 时用最终结果校准状态。

### 6.5 外部数据导入的格式差异

CSV、Excel 和 JSON Bundle 的字段形态不同，Excel sheet 命名也不可控。如果直接把三种格式分别接入业务查询，后续维护成本会很高。

解决方案是“先归一化，再持久化”：`import_service.py` 将 CSV 和 Excel 都转换为 `ClinicalDataImportRequest`，再复用同一套 Bundle 校验和持久化逻辑。所有导入数据最终都以按患者聚合的 JSON 保存，查询服务只需要按 `hadm_id` 读取统一结构。

### 6.6 临床答案需要证据可追溯

临床数据问答不能只给自然语言结论，还需要知道结论来自哪条记录。项目在后端生成 `evidence` 和 `answer_links`，前端只负责渲染和交互，不自行推断字段对应关系。

这个设计避免了 UI 层通过字符串匹配找证据的脆弱实现，也让测试可以直接验证 evidence 数量、类型和字段链接。

## 7. 本地部署

### 7.1 前置要求

- Python 3.8+
- Node.js 16+
- npm

### 7.2 环境配置

复制示例配置：

```powershell
Copy-Item data-service/.env.example data-service/.env
Copy-Item agent-server/.env.example agent-server/.env
Copy-Item frontend/.env.example frontend/.env
```

编辑 `.env`：

```env
# data-service/.env
MIMIC_DATA_DIR=../data/mimic_demo
```

```env
# agent-server/.env
PYTHON_SERVICE_URL=http://localhost:8000
LLM_API_KEY=your-api-key-here
```

```env
# frontend/.env
VITE_AGENT_SERVER_URL=http://localhost:3001
```

`LLM_API_KEY` 可选。未配置时系统会降级为结构化工具 + 本地 RAG 模式。

### 7.3 手动启动

启动数据服务：

```powershell
pip install -r data-service/requirements.txt
python data-service/run.py
```

启动代理服务：

```powershell
npm --prefix agent-server install
npm --prefix agent-server run dev
```

启动前端：

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```

访问 `http://localhost:5173`。

### 7.4 一键启动

首次使用先安装依赖：

```powershell
pip install -r data-service/requirements.txt
npm --prefix agent-server install
npm --prefix frontend install
```

然后运行：

```powershell
./scripts/dev-start-all.ps1
```

可选参数：

```powershell
./scripts/dev-start-all.ps1 -SkipFrontend
./scripts/dev-start-all.ps1 -SkipHealthCheck
```

## 8. 示例问题

结构化数据查询：

- `patient overview for this admission`
- `latest glucose lab result`
- `latest pulse reading`
- `what are the diagnoses for this patient?`

RAG 知识查询：

- `what does pulse measure?`
- `what is charttime field?`
- `what is sepsis?`
- `what does AKI mean?`

上下文追问：

- `What about blood pressure?`
- `And patient info?`
- `那这个指标是什么意思？`

## 9. 外部临床数据导入

### 9.1 可用端点

- Frontend：右侧问答面板中的外部数据导入入口。
- Agent server JSON proxy：`POST /imports/clinical-data`
- Agent server CSV proxy：`POST /imports/clinical-data/csv`
- Agent server Excel proxy：`POST /imports/clinical-data/excel`
- Agent server import history：`GET /imports/clinical-data`
- Agent server delete import：`DELETE /imports/clinical-data/{import_id}`
- Data-service JSON upstream：`POST /imports/clinical-data`
- Data-service CSV upstream：`POST /imports/clinical-data/csv`
- Data-service Excel upstream：`POST /imports/clinical-data/excel`
- Data-service import history：`GET /imports/clinical-data`
- Data-service delete import：`DELETE /imports/clinical-data/{import_id}`

### 9.2 CSV 表结构

最低要求：

- `patients_csv` 必填。
- `patients_csv` 必须包含 `hadm_id`。
- 可选表也必须包含 `hadm_id`，且只能引用 `patients_csv` 中已经存在的患者。

`patients_csv` 支持字段：

- 必填：`hadm_id`
- 可选：`subject_id`、`gender`、`age`、`admittime`、`dischtime`、`admission_type`、`admission_location`、`discharge_location`、`race`、`icu_stay_id`、`icu_intime`、`icu_outtime`

示例：

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

### 9.3 Excel 工作簿结构

Excel 导入使用单个 `.xlsx` 工作簿，经 base64 编码后上传：

- 必需 sheet：`patients`
- 可选 sheet：`diagnoses`、`labs`、`vitals`

sheet 名称匹配不区分大小写，并忽略空格、下划线和连字符。

```json
{
  "dataset_name": "external-icu-demo",
  "excel_bundle": {
    "workbook_name": "external-icu-demo.xlsx",
    "workbook_base64": "<base64-xlsx-bytes>"
  }
}
```

### 9.4 JSON Bundle 结构

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

导入成功后，新 `hadm_id` 会出现在患者选择器中，并能通过原有结构化查询和智能问答流程检索。删除导入数据集时，系统会删除对应持久化文件并刷新患者列表；如果当前选中患者来自被删除的数据集，前端会尝试从剩余数据源重新加载该 `hadm_id`。

## 10. 验证与测试

构建：

```powershell
npm --prefix frontend run build
npm --prefix agent-server run build
```

测试：

```powershell
npm test
```

冒烟验证：

```powershell
./scripts/smoke-test.ps1
```

LLM 开关对比：

```powershell
./evaluation/scripts/run-llm-compare.ps1
```

Phase 3 评估：

```powershell
./evaluation/scripts/run-phase3-eval.ps1
```

## 11. 开发注意事项

- 前端只能调用 `agent-server`，不能直接访问 `data-service` 或 `data/`。
- 新增患者结构化数据时，优先在 `data-service` 增加端点，再在 `agent-server` 增加工具或适配器，最后暴露给 UI。
- 新增知识检索内容时，优先更新 `docs/rag/`，必要时再调整 `agent-server/src/agent/rag/` 的检索规则。
- `docs/rag/` 是本地 JSON 语料，默认不依赖外部向量数据库。
- MIMIC 数据较大时，首次 pandas 读取可能较慢，生产环境可进一步加缓存或索引。
- 临床回答仅用于数据探索和演示，不能替代专业医疗建议。

更多架构边界请参考 [docs/architecture.md](docs/architecture.md)。
