"""
GET /patient/{hadm_id}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.schemas import PatientOverviewResponse
from app.services.diagnosis_service import get_diagnoses
from app.services.patient_service import get_patient_overview

router = APIRouter(tags=["patient"])


def _json_val(v: Any) -> object:
    if v is None:
        return None
    if hasattr(v, "item") and callable(getattr(v, "item", None)):
        try:
            return _json_val(v.item())
        except (ValueError, TypeError, AttributeError):
            return str(v)
    if isinstance(v, (int, float, str, bool)):
        return v
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except (TypeError, ValueError):
            return str(v)
    return str(v)


def _json_dict(d: dict[str, Any]) -> dict[str, object]:
    return {str(k): _json_val(v) for k, v in d.items()}


@router.get("/patient/{hadm_id}", response_model=PatientOverviewResponse)
def read_patient(hadm_id: int) -> PatientOverviewResponse:
    overview = get_patient_overview(hadm_id)
    if not overview:
        raise HTTPException(status_code=404, detail="未查询到该 hadm_id 的入院记录。")

    dx_raw = get_diagnoses(hadm_id)
    diagnoses = [_json_dict(r) for r in dx_raw]

    return PatientOverviewResponse(
        hadm_id=hadm_id,
        patient_overview=_json_dict(overview),
        diagnoses=diagnoses,
    )
