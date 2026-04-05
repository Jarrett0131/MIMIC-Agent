"""
课程 demo API 请求/响应模型（snake_case，与前端对齐）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PatientOverviewResponse(BaseModel):
    """GET /patient/{hadm_id}"""

    hadm_id: int
    patient_overview: dict[str, object] = Field(default_factory=dict)
    diagnoses: list[dict[str, object]] = Field(default_factory=list)


class AskRequest(BaseModel):
    """POST /ask 请求体"""

    hadm_id: int
    question: str = Field(..., min_length=1)


class AskResponse(BaseModel):
    """POST /ask 统一响应"""

    question_type: str
    tool_called: str
    tool_args: dict[str, object]
    answer: str
    evidence: list[dict[str, object]]
    limitation: str
