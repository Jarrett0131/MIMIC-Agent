from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas import DiagnosesResponse
from app.services.diagnosis_service import get_diagnoses

router = APIRouter(prefix="/diagnoses", tags=["diagnoses"])


@router.get("/{hadm_id}", response_model=DiagnosesResponse)
def read_diagnoses(
    hadm_id: int,
    limit: int = Query(default=10, ge=1, le=100),
) -> DiagnosesResponse:
    return DiagnosesResponse(
        hadm_id=hadm_id,
        diagnoses=get_diagnoses(hadm_id, limit=limit),
    )
