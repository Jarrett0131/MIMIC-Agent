# Phase 3 Evaluation And LLM Integration

## Scope

This project now keeps the original three-layer architecture intact while adding two engineering capabilities:

- repeatable offline and live evaluation
- optional but real LLM enhancement using DeepSeek's OpenAI-compatible API

The frontend remains unchanged.

## What The LLM Does

LLM usage is intentionally narrow:

- `queryRewrite`: rewrite short follow-up questions into standalone routing questions
- `answerEnhancement`: improve readability without changing facts
- optional `RAG query normalization`: rewrite a retrieval query into a cleaner search string

The LLM does **not** decide structured patient results.

Structured patient data still comes from deterministic tools because:

- patient demographics, labs, vitals, and diagnoses must stay evidence-first
- structured tool calls are easier to test and debug
- numeric correctness is easier to preserve when the LLM is not in the decision path

## Dataset Coverage

Primary dataset:

- `evaluation/datasets/phase3_evalset.json`

Current coverage:

- `structured`: patient info, labs, vitals, diagnoses
- `rag`: term explanation, metric explanation, field explanation, general knowledge explanation
- `follow_up`: rewrite-sensitive short questions and context-dependent follow-ups

Each sample may include:

- `expected_route`
- `expected_tool`
- `expected_titles`
- `expected_keywords`
- `expected_rewrite`
- `hadm_id`
- `context.last_question_type`

This lets the dataset measure classifier accuracy, router accuracy, retrieval quality, rewrite behavior, and answer completeness.

## Metrics

The evaluation runner writes both summary rates and hit/total details.

Core metrics:

- `route_accuracy`
- `tool_accuracy`
- `rag_top1_hit`
- `rag_top3_hit`
- `rewrite_trigger_rate`
- `rewrite_expected_hit`
- `rewrite_by_llm_rate`
- `rewrite_by_fallback_rate`
- `answer_success_rate`
- `evidence_presence_rate`
- `answer_enhancement_applied_rate`
- `answer_enhancement_fallback_rate`

Per-sample output also includes:

- rewritten question
- rewrite source
- rewrite confidence
- top titles
- keyword coverage
- answer enhancement applied / fallback flags
- tool trace

## Baseline And Experiment Layers

Baseline retrieval:

- local hybrid lexical retriever
- alias, keyword, token overlap, concept hint scoring

Optional retrieval experiments:

- `hybrid -> optional embedding-cache rerank -> final top-k`
- optional `RAG_LLM_QUERY_ENABLED=true` query normalization before retrieval

Key design rule:

- default runtime behavior stays the same when optional switches are off

## DeepSeek LLM Configuration

Relevant environment variables:

```env
LLM_ENABLED=true
LLM_PROVIDER=deepseek
LLM_API_KEY=
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com
LLM_TIMEOUT_MS=8000
LLM_RETRY_TIMES=1

ANSWER_ENHANCEMENT_ENABLED=true
QUERY_REWRITE_ENABLED=true
RAG_LLM_QUERY_ENABLED=false
```

Notes:

- the API key is never hard-coded
- `DEEPSEEK_API_KEY` is also accepted if you prefer DeepSeek's naming
- provider, model, and base URL all come from environment variables
- `https://api.deepseek.com/v1` also works if you prefer the explicit compatibility path
- missing key or request failure automatically degrades to fallback logic
- `llmClient` is the only place that performs LLM HTTP requests

## Optional Rerank And Embedding Cache

Relevant files:

- `agent-server/src/agent/rag/embeddingTypes.ts`
- `agent-server/src/agent/rag/embeddingCache.ts`
- `agent-server/src/agent/rag/rerank.ts`

Behavior:

- disabled by default
- graceful no-op when rerank is off
- graceful no-op when embedding cache is unavailable
- offline evaluation can use the local deterministic `token-hash-v1` provider

Checked-in cache:

- `evaluation/cache/rag_embeddings.json`

## How To Run Evaluation

### Single evaluation

PowerShell:

```powershell
./evaluation/scripts/run-phase3-eval.ps1
```

Node:

```bash
node evaluation/scripts/run-phase3-eval.js --mode offline
```

### LLM_ON vs LLM_OFF comparison

PowerShell:

```powershell
./evaluation/scripts/run-llm-compare.ps1
```

Node:

```bash
node evaluation/scripts/run-llm-compare.js --mode offline
```

Behavior:

- the runner keeps `QUERY_REWRITE_ENABLED=true` and `ANSWER_ENHANCEMENT_ENABLED=true` in both runs
- the main comparison switch is `LLM_ENABLED=false` vs `LLM_ENABLED=true`
- if the `LLM_ON` run still has no usable key or model, `llm_compare_report.md` explicitly marks that run as fallback-only

This generates:

- `evaluation/reports/llm_on_eval_report.json`
- `evaluation/reports/llm_on_eval_report.md`
- `evaluation/reports/llm_off_eval_report.json`
- `evaluation/reports/llm_off_eval_report.md`
- `evaluation/reports/llm_compare_report.md`

If you want live API mode instead:

```bash
node evaluation/scripts/run-llm-compare.js --mode live --agent-server-url http://127.0.0.1:3001
```

## How To Read The Reports

Recommended order:

1. Check `route_accuracy` and `tool_accuracy`.
2. Check `rag_top1_hit` and `rag_top3_hit`.
3. Check `rewrite_expected_hit`, `rewrite_by_llm_rate`, and `rewrite_by_fallback_rate`.
4. Check `answer_enhancement_applied_rate` and `answer_enhancement_fallback_rate`.
5. Use `llm_compare_report.md` to inspect concrete improvements, fallback-dependent samples, and degraded samples.

## Current Runtime Guarantees

- frontend-visible pages are unchanged
- structured data answers still come from deterministic tools
- RAG still uses the local knowledge base
- no key or LLM failure does not break the main path
- optional rerank and optional RAG query normalization are both feature-gated
