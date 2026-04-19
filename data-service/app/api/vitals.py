from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas import VitalRecordsResponse
from app.services.vital_service import get_recent_vitals

router = APIRouter(prefix="/vitals", tags=["vitals"])


@router.get("/recent", response_model=VitalRecordsResponse)
def read_recent_vitals(
    hadm_id: int = Query(..., ge=1),
    keyword: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=100),
) -> VitalRecordsResponse:
    return VitalRecordsResponse(
        hadm_id=hadm_id,
        keyword=keyword,
        records=get_recent_vitals(hadm_id=hadm_id, keyword=keyword, limit=limit),
    )
