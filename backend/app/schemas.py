"""
Pydantic 模型：请求/响应结构，与前端 `src/types/index.ts` 使用相同字段名（snake_case）。

POST /ask 响应 JSON 固定键：question_type, tool_called, tool_args, answer, evidence, limitation。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# 与 classifier / 前端 QuestionType 取值一致（单一事实来源）
QuestionType = Literal["overview", "diagnosis", "lab", "vital", "unknown"]


class AskRequest(BaseModel):
    """POST /ask 请求体：必须提供住院号与自然语言问题。"""

    hadm_id: int = Field(..., description="MIMIC admissions.hadm_id")
    question: str = Field(..., min_length=1, description="用户问题文本")


class AskResponse(BaseModel):
    """POST /ask 统一响应：类型、工具、参数、回答、证据与免责说明。"""

    question_type: QuestionType
    tool_called: str
    tool_args: dict[str, Any]
    answer: str
    evidence: list[dict[str, Any]]
    limitation: str


class IcuStayBrief(BaseModel):
    """ICU 入住摘要（结构化）。"""

    stay_id: int | None = None
    intime: str | None = None
    outtime: str | None = None
    los: float | None = Field(None, description="ICU 住院天数（若源表有 los 列）")


class DiagnosisBrief(BaseModel):
    """诊断一条记录摘要。"""

    seq_num: int | None = None
    icd_code: str | None = None
    icd_version: int | None = None


class PatientOverviewResponse(BaseModel):
    """GET /patient/{hadm_id}：患者基本概览 + ICU + 诊断列表。"""

    hadm_id: int
    subject_id: int | None = None
    gender: str | None = None
    anchor_age: int | None = None
    admittime: str | None = None
    dischtime: str | None = None
    icu_stays: list[IcuStayBrief]
    diagnoses: list[DiagnosisBrief]
