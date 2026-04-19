from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas import LabRecordsResponse
from app.services.lab_service import get_recent_labs

router = APIRouter(prefix="/labs", tags=["labs"])


@router.get("/recent", response_model=LabRecordsResponse)
def read_recent_labs(
    hadm_id: int = Query(..., ge=1),
    keyword: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=100),
) -> LabRecordsResponse:
    return LabRecordsResponse(
        hadm_id=hadm_id,
        keyword=keyword,
        records=get_recent_labs(hadm_id=hadm_id, keyword=keyword, limit=limit),
    )
