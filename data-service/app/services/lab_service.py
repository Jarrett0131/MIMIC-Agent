from __future__ import annotations

from typing import TypeAlias

import pandas as pd

from app.data_loader import data_loader
from app.services.import_service import get_imported_patient

ScalarValue: TypeAlias = str | int | float | bool | None
LabRecordData: TypeAlias = dict[str, ScalarValue]


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


def _float_or_none(value: object) -> float | None:
    normalized = _normalize_scalar(value)
    if normalized is None:
        return None

    try:
        return float(normalized)
    except (TypeError, ValueError):
        return None


def _string_or_none(value: object) -> str | None:
    normalized = _normalize_scalar(value)
    return normalized if isinstance(normalized, str) else None


def _charttime_sort_key(value: object) -> int:
    charttime = pd.to_datetime(value, errors="coerce")
    if pd.isna(charttime):
        return -1

    return int(charttime.value)


def _get_imported_labs(hadm_id: int, keyword: str) -> list[LabRecordData] | None:
    imported_patient = get_imported_patient(hadm_id)
    if imported_patient is None:
        return None

    keyword_lower = keyword.strip().lower()
    if not keyword_lower:
        return []

    return [
        record
        for record in imported_patient.labs
        if isinstance(record.get("label"), str)
        and keyword_lower in record["label"].strip().lower()
    ]


def _get_merged_labs(hadm_id: int, keyword: str) -> pd.DataFrame:
    if not keyword.strip():
        return pd.DataFrame()

    labevents = data_loader.labevents
    labitems = data_loader.d_labitems
    if labevents.empty or labitems.empty:
        return pd.DataFrame()
    if "hadm_id" not in labevents.columns or "itemid" not in labevents.columns:
        return pd.DataFrame()
    if "itemid" not in labitems.columns or "label" not in labitems.columns:
        return pd.DataFrame()

    merged = labevents.merge(
        labitems[["itemid", "label"]].drop_duplicates(subset=["itemid"]),
        on="itemid",
        how="left",
    )
    hadm_series = pd.to_numeric(merged["hadm_id"], errors="coerce")
    matched = merged.loc[hadm_series == hadm_id].copy()
    if matched.empty:
        return pd.DataFrame()

    labels = matched["label"].fillna("").astype(str)
    keyword_lower = keyword.strip().lower()
    return matched.loc[labels.str.lower().str.contains(keyword_lower, regex=False)]


def _to_lab_records(dataframe: pd.DataFrame) -> list[LabRecordData]:
    records: list[LabRecordData] = []
    for _, row in dataframe.iterrows():
        records.append(
            {
                "subject_id": _int_or_none(row.get("subject_id")),
                "hadm_id": _int_or_none(row.get("hadm_id")),
                "itemid": _int_or_none(row.get("itemid")),
                "label": _string_or_none(row.get("label")),
                "charttime": _string_or_none(row.get("charttime")),
                "value": _string_or_none(row.get("value")),
                "valuenum": _float_or_none(row.get("valuenum")),
                "valueuom": _string_or_none(row.get("valueuom")),
                "flag": _string_or_none(row.get("flag")),
            }
        )

    return records


def get_labs_by_keyword(hadm_id: int, keyword: str, limit: int = 20) -> list[LabRecordData]:
    imported_records = _get_imported_labs(hadm_id, keyword)
    if imported_records is not None:
        return imported_records[:limit]

    merged = _get_merged_labs(hadm_id, keyword)
    if merged.empty:
        return []

    return _to_lab_records(merged.head(limit))


def get_recent_labs(hadm_id: int, keyword: str, limit: int = 10) -> list[LabRecordData]:
    imported_records = _get_imported_labs(hadm_id, keyword)
    if imported_records is not None:
        return sorted(
            imported_records,
            key=lambda record: _charttime_sort_key(record.get("charttime")),
            reverse=True,
        )[:limit]

    merged = _get_merged_labs(hadm_id, keyword)
    if merged.empty or "charttime" not in merged.columns:
        return []

    merged["_charttime_dt"] = pd.to_datetime(merged["charttime"], errors="coerce")
    merged = merged.sort_values("_charttime_dt", ascending=False, na_position="last")
    return _to_lab_records(merged.head(limit))
