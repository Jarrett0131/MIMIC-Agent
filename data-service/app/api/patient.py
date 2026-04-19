from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import PatientOverviewResponse
from app.services.diagnosis_service import get_diagnoses
from app.services.patient_service import get_patient_overview

router = APIRouter(tags=["patient"])


@router.get("/patient/{hadm_id}", response_model=PatientOverviewResponse)
def read_patient(hadm_id: int) -> PatientOverviewResponse:
    patient_overview = get_patient_overview(hadm_id)
    if not patient_overview:
        raise HTTPException(status_code=404, detail="hadm_id not found")

    return PatientOverviewResponse(
        hadm_id=hadm_id,
        patient_overview=patient_overview,
        diagnoses=get_diagnoses(hadm_id),
    )
