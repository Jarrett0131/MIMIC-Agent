from __future__ import annotations

from typing import TypeAlias

import pandas as pd

from app.data_loader import data_loader
from app.services.import_service import get_imported_hadm_ids, get_imported_patient

ScalarValue: TypeAlias = str | int | float | bool | None
PatientOverviewData: TypeAlias = dict[str, ScalarValue]


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


def _filter_by_int_column(
    dataframe: pd.DataFrame,
    column: str,
    target: int,
) -> pd.DataFrame:
    if dataframe.empty or column not in dataframe.columns:
        return pd.DataFrame()

    numeric_column = pd.to_numeric(dataframe[column], errors="coerce")
    return dataframe.loc[numeric_column == target].copy()


def get_all_hadm_ids() -> list[int]:
    admissions = data_loader.admissions
    imported_hadm_ids = get_imported_hadm_ids()
    if admissions.empty or "hadm_id" not in admissions.columns:
        return imported_hadm_ids

    hadm_series = pd.to_numeric(admissions["hadm_id"], errors="coerce")
    hadm_ids = hadm_series.dropna().astype("int64")
    hadm_ids = hadm_ids.loc[hadm_ids > 0].drop_duplicates().sort_values(kind="stable")
    return sorted(set(hadm_ids.tolist()) | set(imported_hadm_ids))


def get_patient_overview(hadm_id: int) -> PatientOverviewData:
    imported_patient = get_imported_patient(hadm_id)
    if imported_patient is not None:
        return imported_patient.patient_overview

    admission_rows = _filter_by_int_column(data_loader.admissions, "hadm_id", hadm_id)
    if admission_rows.empty:
        return {}

    admission = admission_rows.iloc[0]
    subject_id = _int_or_none(admission.get("subject_id"))
    if subject_id is None:
        return {}

    patient_rows = _filter_by_int_column(data_loader.patients, "subject_id", subject_id)
    patient = patient_rows.iloc[0] if not patient_rows.empty else None

    icu_rows = _filter_by_int_column(data_loader.icustays, "hadm_id", hadm_id)
    icu_stay_id: int | None = None
    icu_intime: str | None = None
    icu_outtime: str | None = None
    if not icu_rows.empty:
        icu_rows["_intime_dt"] = pd.to_datetime(icu_rows.get("intime"), errors="coerce")
        icu_rows = icu_rows.sort_values("_intime_dt", ascending=True, na_position="last")
        icu = icu_rows.iloc[0]
        icu_stay_id = _int_or_none(icu.get("stay_id"))
        icu_intime_value = _normalize_scalar(icu.get("intime"))
        icu_outtime_value = _normalize_scalar(icu.get("outtime"))
        icu_intime = icu_intime_value if isinstance(icu_intime_value, str) else None
        icu_outtime = icu_outtime_value if isinstance(icu_outtime_value, str) else None

    age: int | None = None
    gender: str | None = None
    if patient is not None:
        age = _int_or_none(patient.get("anchor_age"))
        if age is None:
            age = _int_or_none(patient.get("age"))

        gender_value = _normalize_scalar(patient.get("gender"))
        gender = gender_value if isinstance(gender_value, str) else None

    admittime_value = _normalize_scalar(admission.get("admittime"))
    dischtime_value = _normalize_scalar(admission.get("dischtime"))
    admission_type_value = _normalize_scalar(admission.get("admission_type"))
    admission_location_value = _normalize_scalar(admission.get("admission_location"))
    discharge_location_value = _normalize_scalar(admission.get("discharge_location"))
    race_value = _normalize_scalar(admission.get("race"))

    return {
        "subject_id": subject_id,
        "gender": gender,
        "age": age,
        "admittime": admittime_value if isinstance(admittime_value, str) else None,
        "dischtime": dischtime_value if isinstance(dischtime_value, str) else None,
        "admission_type": (
            admission_type_value if isinstance(admission_type_value, str) else None
        ),
        "admission_location": (
            admission_location_value
            if isinstance(admission_location_value, str)
            else None
        ),
        "discharge_location": (
            discharge_location_value
            if isinstance(discharge_location_value, str)
            else None
        ),
        "race": race_value if isinstance(race_value, str) else None,
        "icu_stay_id": icu_stay_id,
        "icu_intime": icu_intime,
        "icu_outtime": icu_outtime,
    }
