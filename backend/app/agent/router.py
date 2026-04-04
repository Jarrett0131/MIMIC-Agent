"""
路由器：根据 question_type 调用对应 service，组装工具名、参数与原始结构化记录。

不包含自然语言生成；异常时返回空记录并由 generator 提示「未查询到相关记录」。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.agent.classifier import classify_question
from app.schemas import QuestionType
from app.services import diagnosis_service, lab_service, vital_service
from app.services.patient_service import build_patient_panel


@dataclass
class ToolRun:
    """一次工具调用的结构化结果，供 generator 生成 answer 与 evidence。"""

    question_type: QuestionType
    tool_called: str
    tool_args: dict[str, Any]
    records: list[dict[str, Any]]


def _detect_lab_metric(question: str) -> str | None:
    q = question.lower()
    if "乳酸" in q:
        return "lactate"
    if "白细胞" in q:
        return "wbc"
    if "肌酐" in q:
        return "creatinine"
    return None


def _detect_vital_metric(question: str) -> str | None:
    q = question.lower()
    if "血压" in q:
        return "blood_pressure"
    if "心率" in q or "脉搏" in q:
        return "heart_rate"
    if "体温" in q:
        return "temperature"
    return None


def route_question(hadm_id: int, question: str) -> ToolRun:
    """
    对 (hadm_id, question) 执行分类并调用相应数据服务。

    扩展点：后续可将 classify_question 替换为 LLM，仅需保持 ToolRun 契约。
    """
    qtype = classify_question(question)

    if qtype == "unknown":
        return ToolRun(
            question_type="unknown",
            tool_called="none",
            tool_args={"hadm_id": hadm_id},
            records=[],
        )

    if qtype == "overview":
        panel = build_patient_panel(hadm_id)
        return ToolRun(
            question_type="overview",
            tool_called="patient_service.build_patient_panel",
            tool_args={"hadm_id": hadm_id},
            records=[panel],
        )

    if qtype == "diagnosis":
        rows = diagnosis_service.list_diagnoses_for_hadm(hadm_id)
        return ToolRun(
            question_type="diagnosis",
            tool_called="diagnosis_service.list_diagnoses_for_hadm",
            tool_args={"hadm_id": hadm_id},
            records=rows,
        )

    if qtype == "lab":
        metric = _detect_lab_metric(question)
        tool_args: dict[str, Any] = {"hadm_id": hadm_id, "metric": metric}
        if metric is None:
            return ToolRun(
                question_type="lab",
                tool_called="lab_service.query_lab_last_24h",
                tool_args=tool_args,
                records=[],
            )
        rows = lab_service.query_lab_last_24h(hadm_id, metric)
        return ToolRun(
            question_type="lab",
            tool_called="lab_service.query_lab_last_24h",
            tool_args=tool_args,
            records=rows,
        )

    if qtype == "vital":
        metric = _detect_vital_metric(question)
        tool_args = {"hadm_id": hadm_id, "metric": metric}
        if metric == "blood_pressure":
            sys_rows = vital_service.query_vital_last_24h(hadm_id, "nbp_systolic")
            dia_rows = vital_service.query_vital_last_24h(hadm_id, "nbp_diastolic")
            combined = [{"_vital_component": "systolic", **r} for r in sys_rows] + [
                {"_vital_component": "diastolic", **r} for r in dia_rows
            ]
            return ToolRun(
                question_type="vital",
                tool_called="vital_service.query_vital_last_24h",
                tool_args={**tool_args, "components": ["nbp_systolic", "nbp_diastolic"]},
                records=combined,
            )
        if metric is None:
            return ToolRun(
                question_type="vital",
                tool_called="vital_service.query_vital_last_24h",
                tool_args=tool_args,
                records=[],
            )
        internal = (
            "heart_rate"
            if metric == "heart_rate"
            else "temperature"
            if metric == "temperature"
            else None
        )
        if internal is None:
            return ToolRun(
                question_type="vital",
                tool_called="vital_service.query_vital_last_24h",
                tool_args=tool_args,
                records=[],
            )
        rows = vital_service.query_vital_last_24h(hadm_id, internal)
        return ToolRun(
            question_type="vital",
            tool_called="vital_service.query_vital_last_24h",
            tool_args=tool_args,
            records=rows,
        )

    return ToolRun(question_type="unknown", tool_called="none", tool_args={"hadm_id": hadm_id}, records=[])
