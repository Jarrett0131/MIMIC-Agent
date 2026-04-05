"""
Demo 病例探测：汇总某 hadm_id 是否具备各类数据（仅判非空）。
"""

from __future__ import annotations

from app.services.diagnosis_service import get_diagnoses
from app.services.lab_service import get_labs_by_keyword
from app.services.patient_service import get_patient_overview
from app.services.vital_service import get_vitals_by_keyword


def probe_patient_features(hadm_id: int) -> dict[str, bool | int]:
    overview = get_patient_overview(hadm_id)
    dx = get_diagnoses(hadm_id)
    return {
        "hadm_id": hadm_id,
        "has_overview": len(overview) > 0,
        "has_diagnosis": len(dx) > 0,
        "has_lactate": len(get_labs_by_keyword(hadm_id, "lactate", limit=1)) > 0,
        "has_creatinine": len(get_labs_by_keyword(hadm_id, "creatinine", limit=1)) > 0,
        "has_white": len(get_labs_by_keyword(hadm_id, "white", limit=1)) > 0,
        "has_heart_rate": len(get_vitals_by_keyword(hadm_id, "heart rate", limit=1)) > 0,
        "has_blood_pressure": len(get_vitals_by_keyword(hadm_id, "blood pressure", limit=1)) > 0,
    }
