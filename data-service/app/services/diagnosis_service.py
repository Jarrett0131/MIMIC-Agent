from __future__ import annotations

from typing import TypeAlias

import pandas as pd

from app.data_loader import data_loader
from app.services.import_service import get_imported_patient

ScalarValue: TypeAlias = str | int | float | bool | None
DiagnosisData: TypeAlias = dict[str, ScalarValue]


def _normalize_scalar(value: object) -> ScalarValue:
    if value is None or pd.isna(value):
        return None

    if hasattr(value, "item") and callable(getattr(value, "item")):
        try:
            value = value.item()
        except (TypeError, ValueError):
            pass

    if hasattr(value, "isoformat") and callable(getattr(value, "isoformat")):
        try:
            return str(value.isoformat())
        except (TypeError, ValueError):
            return str(value)

    if isinstance(value, (str, int, float, bool)):
        return value

    return str(value)


def _int_or_none(value: object) -> int | None:
    normalized = _normalize_scalar(value)
    if normalized is None:
        return None

    try:
        return int(normalized)
    except (TypeError, ValueError):
        return None


def _string_or_none(value: object) -> str | None:
    normalized = _normalize_scalar(value)
    return normalized if isinstance(normalized, str) else None


def get_diagnoses(hadm_id: int, limit: int = 10) -> list[DiagnosisData]:
    imported_patient = get_imported_patient(hadm_id)
    if imported_patient is not None:
        return imported_patient.diagnoses[:limit]

    diagnoses = data_loader.diagnoses_icd
    if diagnoses.empty or "hadm_id" not in diagnoses.columns:
        return []

    hadm_series = pd.to_numeric(diagnoses["hadm_id"], errors="coerce")
    matched = diagnoses.loc[hadm_series == hadm_id].copy()
    if matched.empty:
        return []

    if "seq_num" in matched.columns:
        matched["_seq_num_sort"] = pd.to_numeric(matched["seq_num"], errors="coerce")
        matched = matched.sort_values("_seq_num_sort", ascending=True, na_position="last")

    matched = matched.head(limit)

    records: list[DiagnosisData] = []
    for _, row in matched.iterrows():
        records.append(
            {
                "subject_id": _int_or_none(row.get("subject_id")),
                "hadm_id": _int_or_none(row.get("hadm_id")),
                "seq_num": _int_or_none(row.get("seq_num")),
                "icd_code": _string_or_none(row.get("icd_code")),
                "icd_version": _int_or_none(row.get("icd_version")),
            }
        )

    return records
