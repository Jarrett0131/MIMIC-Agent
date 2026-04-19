# Architecture Definition

This document defines the supported architecture for the repository after the cleanup completed on 2026-04-16.

## 1. System Shape

```text
frontend
  -> agent-server
      -> data-service
          -> MIMIC-IV demo CSV
      -> docs/rag
      -> optional LLM
```

This means:

- `frontend/` is the UI.
- `agent-server/` is the agent and orchestration gateway.
- `data-service/` is the only clinical data backend.

## 2. Responsibilities

### `frontend/`

Owns:

- user interaction
- patient selection
- chat state and flow visualization
- evidence display and linking
- debug and developer-facing UI panels

Must not own:

- direct access to MIMIC demo files
- direct access to `data-service/`
- routing or answer composition logic

### `agent-server/`

Owns:

- request validation
- context assembly
- query rewrite
- classification
- tool routing
- RAG retrieval
- LLM-based enhancement
- answer composition
- streaming response protocol

Must not own:

- pandas data loading
- direct CSV business logic
- duplicated patient-data source-of-truth logic already defined in `data-service/`

### `data-service/`

Owns:

- loading the MIMIC-IV demo dataset
- pandas-based querying and aggregation
- structured API responses for patient data
- backend-side data normalization for structured endpoints

Must not own:

- chat orchestration
- follow-up dialogue planning
- LLM prompting for answer generation
- RAG retrieval and evidence composition

## 3. Call Boundaries

Mandatory rules:

- `frontend/` calls `agent-server/` only.
- `agent-server/` calls `data-service/` for structured clinical data.
- `agent-server/` reads retrieval assets from `docs/rag/`.
- `data-service/` reads demo data from `data/`.

Not allowed:

- `frontend/ -> data-service/`
- `frontend/ -> data/`
- `data-service/ -> docs/rag/` for answer generation
- `data-service/ -> LLM` for orchestration

## 4. Directory Contract

### Keep and extend

- `frontend/`
- `agent-server/`
- `data-service/`
- `docs/rag/`
- `scripts/`
- `evaluation/`
- `data/`

### Removed or no longer supported

- `backend/`

If a future feature needs new patient data:

1. Add the structured endpoint in `data-service/`.
2. Add the corresponding adapter or tool in `agent-server/`.
3. Expose it to the UI through `agent-server/`.

If a future feature needs new knowledge retrieval:

1. Add or update assets in `docs/rag/`.
2. Update retrieval or answer composition in `agent-server/`.
3. Surface evidence in `frontend/`.

## 5. Design Intent

This split keeps the project maintainable:

- Python remains the backend for clinical data access.
- Node remains the agent layer for orchestration and enhancement.
- React remains the presentation layer.

That separation is intentional. New code should strengthen this boundary, not blur it.
