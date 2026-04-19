from __future__ import annotations

from fastapi import APIRouter

from app.schemas import PatientIdListResponse
from app.services.patient_service import get_all_hadm_ids

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("/ids", response_model=PatientIdListResponse)
def read_patient_ids() -> PatientIdListResponse:
    hadm_ids = get_all_hadm_ids()
    return PatientIdListResponse(hadm_ids=hadm_ids, total=len(hadm_ids))
