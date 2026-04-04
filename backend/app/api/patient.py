"""
患者相关 HTTP 接口：聚合 patient / icu / diagnosis 结构化结果。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import DiagnosisBrief, IcuStayBrief, PatientOverviewResponse
from app.services.diagnosis_service import list_diagnoses_for_hadm
from app.services.patient_service import build_patient_panel

router = APIRouter(tags=["patient"])


@router.get("/patient/{hadm_id}", response_model=PatientOverviewResponse)
def get_patient_overview(hadm_id: int) -> PatientOverviewResponse:
    """
    返回指定 hadm_id 的患者基本概览、ICU 入住列表与诊断列表。
    若入院记录不存在，返回 404。
    """
    panel = build_patient_panel(hadm_id)
    if not panel.get("found"):
        raise HTTPException(status_code=404, detail="未查询到该 hadm_id 的入院记录。")

    icu_raw = panel.get("icu_stays") or []
    icu_stays = [IcuStayBrief(**x) for x in icu_raw]

    dx_raw = list_diagnoses_for_hadm(hadm_id)
    diagnoses = [DiagnosisBrief(**x) for x in dx_raw]

    return PatientOverviewResponse(
        hadm_id=hadm_id,
        subject_id=panel.get("subject_id"),
        gender=panel.get("gender"),
        anchor_age=panel.get("anchor_age"),
        admittime=panel.get("admittime"),
        dischtime=panel.get("dischtime"),
        icu_stays=icu_stays,
        diagnoses=diagnoses,
    )
