"""
工具路由：按 question_type 调用 service，只返回结构化 data。
"""

from __future__ import annotations

from app.services.diagnosis_service import get_diagnoses
from app.services.lab_service import get_recent_labs
from app.services.patient_service import get_patient_overview
from app.services.vital_service import get_recent_vitals


def route_question(hadm_id: int, question_type: str) -> dict[str, object]:
    """
    返回 { tool_called, tool_args, data }。
    data 为 dict 或 list，unsupported 时 data 为 None。
    """
    if question_type == "overview":
        data = get_patient_overview(hadm_id)
        return {
            "tool_called": "get_patient_overview",
            "tool_args": {"hadm_id": hadm_id},
            "data": data,
        }

    if question_type == "diagnosis":
        data = get_diagnoses(hadm_id)
        return {
            "tool_called": "get_diagnoses",
            "tool_args": {"hadm_id": hadm_id},
            "data": data,
        }

    if question_type == "lab_lactate":
        data = get_recent_labs(hadm_id, "lactate")
        return {
            "tool_called": "get_recent_labs",
            "tool_args": {"hadm_id": hadm_id, "keyword": "lactate"},
            "data": data,
        }

    if question_type == "lab_creatinine":
        data = get_recent_labs(hadm_id, "creatinine")
        return {
            "tool_called": "get_recent_labs",
            "tool_args": {"hadm_id": hadm_id, "keyword": "creatinine"},
            "data": data,
        }

    if question_type == "lab_white":
        data = get_recent_labs(hadm_id, "white")
        return {
            "tool_called": "get_recent_labs",
            "tool_args": {"hadm_id": hadm_id, "keyword": "white"},
            "data": data,
        }

    if question_type == "vital_heart_rate":
        data = get_recent_vitals(hadm_id, "heart rate")
        return {
            "tool_called": "get_recent_vitals",
            "tool_args": {"hadm_id": hadm_id, "keyword": "heart rate"},
            "data": data,
        }

    if question_type == "vital_blood_pressure":
        data = get_recent_vitals(hadm_id, "blood pressure")
        return {
            "tool_called": "get_recent_vitals",
            "tool_args": {"hadm_id": hadm_id, "keyword": "blood pressure"},
            "data": data,
        }

    return {
        "tool_called": "none",
        "tool_args": {"hadm_id": hadm_id},
        "data": None,
    }
