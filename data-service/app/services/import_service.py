from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from io import StringIO
import json
from pathlib import Path
import re
from threading import Lock
from typing import Any, TypeAlias
from uuid import uuid4

import pandas as pd

from app.config import EXTERNAL_CLINICAL_IMPORT_DIR
from app.schemas import (
    ClinicalDataBundle,
    ClinicalDataCsvBundle,
    ClinicalDataCsvImportRequest,
    ClinicalDataExcelImportRequest,
    ClinicalDataImportRequest,
    DiagnosisRecord,
    ExternalClinicalMetadata,
    ImportedClinicalPatient,
    LabRecord,
    PatientOverview,
    VitalRecord,
)

ScalarValue: TypeAlias = str | int | float | bool | None
PatientOverviewData: TypeAlias = dict[str, ScalarValue]
DiagnosisData: TypeAlias = dict[str, ScalarValue]
LabRecordData: TypeAlias = dict[str, ScalarValue]
VitalRecordData: TypeAlias = dict[str, ScalarValue]

PATIENT_OVERVIEW_FIELDS = (
    "subject_id",
    "gender",
    "age",
    "admittime",
    "dischtime",
    "admission_type",
    "admission_location",
    "discharge_location",
    "race",
    "icu_stay_id",
    "icu_intime",
    "icu_outtime",
)

DIAGNOSIS_FIELDS = ("subject_id", "hadm_id", "seq_num", "icd_code", "icd_version")
LAB_FIELDS = (
    "subject_id",
    "hadm_id",
    "itemid",
    "label",
    "charttime",
    "value",
    "valuenum",
    "valueuom",
    "flag",
)
VITAL_FIELDS = (
    "subject_id",
    "hadm_id",
    "stay_id",
    "itemid",
    "label",
    "charttime",
    "value",
    "valuenum",
    "valueuom",
    "warning",
)

EXCEL_SHEET_ALIASES = {
    "patients": ("patients", "patient", "patientoverview", "overview"),
    "diagnoses": ("diagnoses", "diagnosis", "diagnosisrecords"),
    "labs": ("labs", "lab", "labevents", "labrecords"),
    "vitals": ("vitals", "vital", "chartevents", "vitalrecords"),
}


class ClinicalDataImportError(Exception):
    pass


class ClinicalDataImportValidationError(ClinicalDataImportError):
    pass


class ClinicalDataImportNotFoundError(ClinicalDataImportError):
    pass


@dataclass(frozen=True)
class ImportedPatientRecord:
    hadm_id: int
    patient_overview: PatientOverviewData
    diagnoses: list[DiagnosisData]
    labs: list[LabRecordData]
    vitals: list[VitalRecordData]


@dataclass(frozen=True)
class PersistedImportRecord:
    import_id: str
    dataset_name: str
    imported_at: str
    stored_path: str
    patient_count: int
    hadm_ids: list[int]
    record_counts: dict[str, int]


_import_lock = Lock()
_imports_loaded = False
_imported_patients: dict[int, ImportedPatientRecord] = {}


def _model_dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump") and callable(getattr(value, "model_dump")):
        return value.model_dump()
    if hasattr(value, "dict") and callable(getattr(value, "dict")):
        return value.dict()
    if isinstance(value, dict):
        return value
    raise ClinicalDataImportValidationError("Import payload is not a valid object.")


def _normalize_scalar(value: object) -> ScalarValue:
    if value is None:
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


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None

    trimmed = value.strip()
    return trimmed or None


def _dataset_name_from_file_name(value: str | None) -> str | None:
    normalized = _clean_text(value)
    if not normalized:
        return None

    return Path(normalized).stem.strip() or None


def _normalize_int(value: object) -> int | None:
    normalized = _normalize_scalar(value)
    if normalized is None:
        return None

    try:
        return int(normalized)
    except (TypeError, ValueError):
        return None


def _normalize_float(value: object) -> float | None:
    normalized = _normalize_scalar(value)
    if normalized is None:
        return None

    try:
        return float(normalized)
    except (TypeError, ValueError):
        return None


def _normalize_string(value: object) -> str | None:
    normalized = _normalize_scalar(value)
    return normalized if isinstance(normalized, str) and normalized.strip() else None


def _normalize_bool(value: object) -> bool | None:
    normalized = _normalize_scalar(value)
    if isinstance(normalized, bool):
        return normalized
    if isinstance(normalized, str):
        lowered = normalized.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
    return None


def _normalize_patient_overview(payload: dict[str, Any]) -> PatientOverviewData:
    return {
        "subject_id": _normalize_int(payload.get("subject_id")),
        "gender": _normalize_string(payload.get("gender")),
        "age": _normalize_int(payload.get("age")),
        "admittime": _normalize_string(payload.get("admittime")),
        "dischtime": _normalize_string(payload.get("dischtime")),
        "admission_type": _normalize_string(payload.get("admission_type")),
        "admission_location": _normalize_string(payload.get("admission_location")),
        "discharge_location": _normalize_string(payload.get("discharge_location")),
        "race": _normalize_string(payload.get("race")),
        "icu_stay_id": _normalize_int(payload.get("icu_stay_id")),
        "icu_intime": _normalize_string(payload.get("icu_intime")),
        "icu_outtime": _normalize_string(payload.get("icu_outtime")),
    }


def _normalize_diagnosis(
    payload: dict[str, Any],
    hadm_id: int,
    subject_id: int | None,
) -> DiagnosisData:
    return {
        "subject_id": _normalize_int(payload.get("subject_id")) or subject_id,
        "hadm_id": _normalize_int(payload.get("hadm_id")) or hadm_id,
        "seq_num": _normalize_int(payload.get("seq_num")),
        "icd_code": _normalize_string(payload.get("icd_code")),
        "icd_version": _normalize_int(payload.get("icd_version")),
    }


def _normalize_lab(
    payload: dict[str, Any],
    hadm_id: int,
    subject_id: int | None,
) -> LabRecordData:
    return {
        "subject_id": _normalize_int(payload.get("subject_id")) or subject_id,
        "hadm_id": _normalize_int(payload.get("hadm_id")) or hadm_id,
        "itemid": _normalize_int(payload.get("itemid")),
        "label": _normalize_string(payload.get("label")),
        "charttime": _normalize_string(payload.get("charttime")),
        "value": _normalize_string(payload.get("value")),
        "valuenum": _normalize_float(payload.get("valuenum")),
        "valueuom": _normalize_string(payload.get("valueuom")),
        "flag": _normalize_string(payload.get("flag")),
    }


def _normalize_vital(
    payload: dict[str, Any],
    hadm_id: int,
    subject_id: int | None,
) -> VitalRecordData:
    return {
        "subject_id": _normalize_int(payload.get("subject_id")) or subject_id,
        "hadm_id": _normalize_int(payload.get("hadm_id")) or hadm_id,
        "stay_id": _normalize_int(payload.get("stay_id")),
        "itemid": _normalize_int(payload.get("itemid")),
        "label": _normalize_string(payload.get("label")),
        "charttime": _normalize_string(payload.get("charttime")),
        "value": _normalize_string(payload.get("value")),
        "valuenum": _normalize_float(payload.get("valuenum")),
        "valueuom": _normalize_string(payload.get("valueuom")),
        "warning": _normalize_int(payload.get("warning")),
    }


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:40] or "dataset"


def _build_import_id() -> str:
    current_time = datetime.now(timezone.utc)
    timestamp = current_time.strftime("%Y%m%d%H%M%S")
    return f"external-{timestamp}-{uuid4().hex[:8]}"


def _normalize_excel_sheet_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def _empty_import_record_counts() -> dict[str, int]:
    return {
        "diagnoses": 0,
        "labs": 0,
        "vitals": 0,
    }


def _build_import_summary(
    *,
    import_id: str,
    dataset_name: str,
    imported_at: str,
    stored_path: str,
    normalized_records: list[ImportedPatientRecord],
) -> PersistedImportRecord:
    record_counts = _empty_import_record_counts()
    record_counts["diagnoses"] = sum(len(patient.diagnoses) for patient in normalized_records)
    record_counts["labs"] = sum(len(patient.labs) for patient in normalized_records)
    record_counts["vitals"] = sum(len(patient.vitals) for patient in normalized_records)

    return PersistedImportRecord(
        import_id=import_id,
        dataset_name=dataset_name,
        imported_at=imported_at,
        stored_path=stored_path,
        patient_count=len(normalized_records),
        hadm_ids=sorted(patient.hadm_id for patient in normalized_records),
        record_counts=record_counts,
    )


def _normalize_patient_record(patient: Any, index: int) -> ImportedPatientRecord:
    payload = _model_dump(patient)
    hadm_id = _normalize_int(payload.get("hadm_id"))
    if hadm_id is None or hadm_id <= 0:
        raise ClinicalDataImportValidationError(
            f'patients[{index}].hadm_id must be a positive integer.'
        )

    overview_payload = _model_dump(payload.get("patient_overview") or {})
    patient_overview = _normalize_patient_overview(overview_payload)
    subject_id = _normalize_int(patient_overview.get("subject_id"))

    diagnoses_raw = payload.get("diagnoses") or []
    labs_raw = payload.get("labs") or []
    vitals_raw = payload.get("vitals") or []

    if not isinstance(diagnoses_raw, list):
        raise ClinicalDataImportValidationError(f'patients[{index}].diagnoses must be an array.')
    if not isinstance(labs_raw, list):
        raise ClinicalDataImportValidationError(f'patients[{index}].labs must be an array.')
    if not isinstance(vitals_raw, list):
        raise ClinicalDataImportValidationError(f'patients[{index}].vitals must be an array.')

    diagnoses = [
        _normalize_diagnosis(_model_dump(item), hadm_id, subject_id)
        for item in diagnoses_raw
    ]
    labs = [_normalize_lab(_model_dump(item), hadm_id, subject_id) for item in labs_raw]
    vitals = [
        _normalize_vital(_model_dump(item), hadm_id, subject_id)
        for item in vitals_raw
    ]

    return ImportedPatientRecord(
        hadm_id=hadm_id,
        patient_overview=patient_overview,
        diagnoses=diagnoses,
        labs=labs,
        vitals=vitals,
    )


def _normalize_bundle(request: ClinicalDataImportRequest) -> list[ImportedPatientRecord]:
    bundle = _model_dump(request.bundle)
    patients_raw = bundle.get("patients") or []
    if not isinstance(patients_raw, list) or len(patients_raw) == 0:
        raise ClinicalDataImportValidationError(
            'bundle.patients must contain at least one patient.'
        )

    seen_hadm_ids: set[int] = set()
    normalized_records: list[ImportedPatientRecord] = []

    for index, patient in enumerate(patients_raw):
        normalized = _normalize_patient_record(patient, index)
        if normalized.hadm_id in seen_hadm_ids:
            raise ClinicalDataImportValidationError(
                f"Duplicate hadm_id found in bundle: {normalized.hadm_id}."
            )

        seen_hadm_ids.add(normalized.hadm_id)
        normalized_records.append(normalized)

    return normalized_records


def _read_csv_text(csv_text: str | None, label: str, *, required: bool) -> pd.DataFrame:
    normalized = (csv_text or "").lstrip("\ufeff").strip()
    if not normalized:
        if required:
            raise ClinicalDataImportValidationError(f'"{label}" must not be empty.')
        return pd.DataFrame()

    try:
        return pd.read_csv(StringIO(normalized))
    except Exception as error:
        raise ClinicalDataImportValidationError(
            f'Failed to parse "{label}" as CSV: {error}'
        ) from error


def _normalize_csv_row(row: pd.Series, fields: tuple[str, ...]) -> dict[str, Any]:
    return {field: _normalize_scalar(row.get(field)) for field in fields}


def _validate_csv_hadm_ids(
    dataframe: pd.DataFrame,
    label: str,
    known_hadm_ids: set[int],
) -> None:
    if dataframe.empty:
        return

    if "hadm_id" not in dataframe.columns:
        raise ClinicalDataImportValidationError(f'"{label}" must include a "hadm_id" column.')

    invalid_hadm_ids: list[int] = []
    for index, raw_value in enumerate(dataframe["hadm_id"].tolist()):
        hadm_id = _normalize_int(raw_value)
        if hadm_id is None or hadm_id <= 0:
            raise ClinicalDataImportValidationError(
                f'"{label}" row {index + 1} must provide a positive integer hadm_id.'
            )

        if hadm_id not in known_hadm_ids:
            invalid_hadm_ids.append(hadm_id)

    if invalid_hadm_ids:
        raise ClinicalDataImportValidationError(
            f'"{label}" references hadm_id values not found in patients_csv: '
            f'{", ".join(str(value) for value in sorted(set(invalid_hadm_ids)))}.'
        )


def _group_csv_records_by_hadm(
    dataframe: pd.DataFrame,
    fields: tuple[str, ...],
) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[int, list[dict[str, Any]]] = {}
    if dataframe.empty:
        return grouped

    for _, row in dataframe.iterrows():
        hadm_id = _normalize_int(row.get("hadm_id"))
        if hadm_id is None or hadm_id <= 0:
            continue

        grouped.setdefault(hadm_id, []).append(_normalize_csv_row(row, fields))

    return grouped


def _build_bundle_from_csv_request(
    request: ClinicalDataCsvImportRequest,
) -> ClinicalDataImportRequest:
    patients_df = _read_csv_text(
        request.csv_bundle.patients_csv,
        "patients_csv",
        required=True,
    )
    if patients_df.empty:
        raise ClinicalDataImportValidationError('"patients_csv" must contain at least one row.')
    if "hadm_id" not in patients_df.columns:
        raise ClinicalDataImportValidationError('"patients_csv" must include a "hadm_id" column.')

    diagnoses_df = _read_csv_text(
        request.csv_bundle.diagnoses_csv,
        "diagnoses_csv",
        required=False,
    )
    labs_df = _read_csv_text(request.csv_bundle.labs_csv, "labs_csv", required=False)
    vitals_df = _read_csv_text(request.csv_bundle.vitals_csv, "vitals_csv", required=False)

    imported_patients: list[ImportedClinicalPatient] = []
    known_hadm_ids: set[int] = set()

    for index, (_, row) in enumerate(patients_df.iterrows()):
        hadm_id = _normalize_int(row.get("hadm_id"))
        if hadm_id is None or hadm_id <= 0:
            raise ClinicalDataImportValidationError(
                f'patients_csv row {index + 1} must provide a positive integer hadm_id.'
            )
        if hadm_id in known_hadm_ids:
            raise ClinicalDataImportValidationError(
                f'Duplicate hadm_id found in patients_csv: {hadm_id}.'
            )
        known_hadm_ids.add(hadm_id)

    _validate_csv_hadm_ids(diagnoses_df, "diagnoses_csv", known_hadm_ids)
    _validate_csv_hadm_ids(labs_df, "labs_csv", known_hadm_ids)
    _validate_csv_hadm_ids(vitals_df, "vitals_csv", known_hadm_ids)

    diagnoses_by_hadm = _group_csv_records_by_hadm(diagnoses_df, DIAGNOSIS_FIELDS)
    labs_by_hadm = _group_csv_records_by_hadm(labs_df, LAB_FIELDS)
    vitals_by_hadm = _group_csv_records_by_hadm(vitals_df, VITAL_FIELDS)

    for _, row in patients_df.iterrows():
        patient_payload = _normalize_csv_row(row, ("hadm_id",) + PATIENT_OVERVIEW_FIELDS)
        hadm_id = _normalize_int(patient_payload.get("hadm_id"))
        if hadm_id is None or hadm_id <= 0:
            continue
        subject_id = _normalize_int(patient_payload.get("subject_id"))

        imported_patients.append(
            ImportedClinicalPatient(
                hadm_id=hadm_id,
                patient_overview=PatientOverview(
                    subject_id=subject_id,
                    gender=_normalize_string(patient_payload.get("gender")),
                    age=_normalize_int(patient_payload.get("age")),
                    admittime=_normalize_string(patient_payload.get("admittime")),
                    dischtime=_normalize_string(patient_payload.get("dischtime")),
                    admission_type=_normalize_string(patient_payload.get("admission_type")),
                    admission_location=_normalize_string(
                        patient_payload.get("admission_location")
                    ),
                    discharge_location=_normalize_string(
                        patient_payload.get("discharge_location")
                    ),
                    race=_normalize_string(patient_payload.get("race")),
                    icu_stay_id=_normalize_int(patient_payload.get("icu_stay_id")),
                    icu_intime=_normalize_string(patient_payload.get("icu_intime")),
                    icu_outtime=_normalize_string(patient_payload.get("icu_outtime")),
                ),
                diagnoses=[
                    DiagnosisRecord(**_normalize_diagnosis(record, hadm_id, subject_id))
                    for record in diagnoses_by_hadm.get(hadm_id, [])
                ],
                labs=[
                    LabRecord(**_normalize_lab(record, hadm_id, subject_id))
                    for record in labs_by_hadm.get(hadm_id, [])
                ],
                vitals=[
                    VitalRecord(**_normalize_vital(record, hadm_id, subject_id))
                    for record in vitals_by_hadm.get(hadm_id, [])
                ],
            )
        )

    return ClinicalDataImportRequest(
        dataset_name=request.dataset_name,
        bundle=ClinicalDataBundle(
            metadata=ExternalClinicalMetadata(name=request.dataset_name),
            patients=imported_patients,
        ),
    )


def _read_excel_workbook(
    request: ClinicalDataExcelImportRequest,
) -> dict[str, pd.DataFrame]:
    workbook_base64 = _clean_text(request.excel_bundle.workbook_base64)
    if not workbook_base64:
        raise ClinicalDataImportValidationError('"excel_bundle.workbook_base64" must not be empty.')

    try:
        workbook_bytes = base64.b64decode(workbook_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ClinicalDataImportValidationError(
            "excel_bundle.workbook_base64 is not valid base64."
        ) from error

    try:
        workbook = pd.read_excel(
            BytesIO(workbook_bytes),
            sheet_name=None,
            engine="openpyxl",
        )
    except Exception as error:
        raise ClinicalDataImportValidationError(
            f"Failed to parse Excel workbook: {error}"
        ) from error

    normalized_workbook: dict[str, pd.DataFrame] = {}
    for sheet_name, dataframe in workbook.items():
        normalized_name = _normalize_excel_sheet_name(sheet_name)
        if not normalized_name:
            continue

        normalized_workbook[normalized_name] = dataframe.dropna(how="all").copy()

    if not normalized_workbook:
        raise ClinicalDataImportValidationError("Excel workbook does not contain any readable sheets.")

    return normalized_workbook


def _select_excel_sheet(
    workbook: dict[str, pd.DataFrame],
    logical_name: str,
    *,
    required: bool,
) -> pd.DataFrame:
    aliases = EXCEL_SHEET_ALIASES[logical_name]
    for alias in aliases:
        dataframe = workbook.get(alias)
        if dataframe is not None:
            return dataframe

    if logical_name == "patients" and required and len(workbook) == 1:
        return next(iter(workbook.values()))

    if required:
        raise ClinicalDataImportValidationError(
            f'Excel workbook is missing the required "{logical_name}" sheet.'
        )

    return pd.DataFrame()


def _build_bundle_from_excel_request(
    request: ClinicalDataExcelImportRequest,
) -> ClinicalDataImportRequest:
    workbook = _read_excel_workbook(request)
    dataset_name = (
        _clean_text(request.dataset_name)
        or _dataset_name_from_file_name(request.excel_bundle.workbook_name)
        or "External Excel Dataset"
    )

    csv_request = ClinicalDataCsvImportRequest(
        dataset_name=dataset_name,
        csv_bundle=ClinicalDataCsvBundle(
            patients_csv=_select_excel_sheet(workbook, "patients", required=True).to_csv(
                index=False
            ),
            diagnoses_csv=_select_excel_sheet(workbook, "diagnoses", required=False).to_csv(
                index=False
            ),
            labs_csv=_select_excel_sheet(workbook, "labs", required=False).to_csv(
                index=False
            ),
            vitals_csv=_select_excel_sheet(workbook, "vitals", required=False).to_csv(
                index=False
            ),
        ),
    )

    return _build_bundle_from_csv_request(csv_request)


def _restore_from_file(path: Path) -> None:
    _, _, normalized_records = _read_persisted_import(path)
    for patient in normalized_records:
        _imported_patients[patient.hadm_id] = patient


def _read_persisted_import(
    path: Path,
) -> tuple[dict[str, Any], ClinicalDataImportRequest, list[ImportedPatientRecord]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ClinicalDataImportValidationError("Persisted import file root must be an object.")

    bundle = raw.get("bundle")
    if bundle is None:
        raise ClinicalDataImportValidationError("Persisted import file is missing bundle data.")

    request = ClinicalDataImportRequest(
        dataset_name=raw.get("dataset_name"),
        bundle=bundle,
    )
    normalized_records = _normalize_bundle(request)
    return raw, request, normalized_records


def _persisted_import_to_summary(path: Path) -> PersistedImportRecord:
    raw, request, normalized_records = _read_persisted_import(path)
    import_id = _clean_text(raw.get("import_id")) or path.stem
    imported_at = _clean_text(raw.get("imported_at")) or datetime.fromtimestamp(
        path.stat().st_mtime,
        tz=timezone.utc,
    ).replace(microsecond=0).isoformat()
    dataset_name = (
        _clean_text(raw.get("dataset_name"))
        or _clean_text(request.dataset_name)
        or _clean_text(request.bundle.metadata.name)
        or "External Clinical Dataset"
    )

    return _build_import_summary(
        import_id=import_id,
        dataset_name=dataset_name,
        imported_at=imported_at,
        stored_path=str(path),
        normalized_records=normalized_records,
    )


def _ensure_imports_loaded() -> None:
    global _imports_loaded

    if _imports_loaded:
        return

    with _import_lock:
        if _imports_loaded:
            return

        _imported_patients.clear()
        for file_path in sorted(EXTERNAL_CLINICAL_IMPORT_DIR.glob("*.json")):
            try:
                _restore_from_file(file_path)
            except Exception as error:
                print(f"[ImportService] failed to load {file_path}: {error}")

        _imports_loaded = True


def reset_external_import_cache() -> None:
    global _imports_loaded

    with _import_lock:
        _imported_patients.clear()
        _imports_loaded = False


def get_imported_patient(hadm_id: int) -> ImportedPatientRecord | None:
    _ensure_imports_loaded()
    return _imported_patients.get(hadm_id)


def get_imported_hadm_ids() -> list[int]:
    _ensure_imports_loaded()
    return sorted(_imported_patients.keys())


def list_imported_datasets() -> list[dict[str, Any]]:
    items: list[PersistedImportRecord] = []

    for file_path in sorted(EXTERNAL_CLINICAL_IMPORT_DIR.glob("*.json")):
        try:
            items.append(_persisted_import_to_summary(file_path))
        except Exception as error:
            print(f"[ImportService] failed to summarize {file_path}: {error}")

    items.sort(key=lambda item: item.imported_at, reverse=True)
    return [
        {
            "import_id": item.import_id,
            "dataset_name": item.dataset_name,
            "imported_at": item.imported_at,
            "stored_path": item.stored_path,
            "patient_count": item.patient_count,
            "hadm_ids": item.hadm_ids,
            "record_counts": item.record_counts,
        }
        for item in items
    ]


def delete_imported_dataset(import_id: str) -> dict[str, Any]:
    normalized_import_id = _clean_text(import_id)
    if not normalized_import_id:
        raise ClinicalDataImportValidationError("import_id must not be empty.")

    for file_path in sorted(EXTERNAL_CLINICAL_IMPORT_DIR.glob("*.json")):
        try:
            summary = _persisted_import_to_summary(file_path)
        except Exception as error:
            print(f"[ImportService] failed to summarize {file_path}: {error}")
            continue

        if summary.import_id != normalized_import_id:
            continue

        try:
            file_path.unlink()
        except OSError as error:
            raise ClinicalDataImportError(
                f"Failed to delete imported dataset {normalized_import_id}: {error}"
            ) from error

        reset_external_import_cache()
        _ensure_imports_loaded()
        return {
            "import_id": summary.import_id,
            "dataset_name": summary.dataset_name,
            "imported_at": summary.imported_at,
            "stored_path": summary.stored_path,
            "patient_count": summary.patient_count,
            "hadm_ids": summary.hadm_ids,
            "record_counts": summary.record_counts,
        }

    raise ClinicalDataImportNotFoundError(
        f'Imported dataset "{normalized_import_id}" was not found.'
    )


def import_clinical_data(request: ClinicalDataImportRequest) -> dict[str, Any]:
    _ensure_imports_loaded()

    normalized_records = _normalize_bundle(request)
    dataset_name = (
        _clean_text(request.dataset_name)
        or _clean_text(request.bundle.metadata.name)
        or "External Clinical Dataset"
    )
    import_id = _build_import_id()
    imported_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    file_name = f"{_slugify(dataset_name)}-{import_id}.json"
    stored_path = EXTERNAL_CLINICAL_IMPORT_DIR / file_name

    payload = {
        "import_id": import_id,
        "dataset_name": dataset_name,
        "imported_at": imported_at,
        "bundle": _model_dump(request.bundle),
    }

    try:
        stored_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as error:
        raise ClinicalDataImportError(f"Failed to persist imported dataset: {error}") from error

    with _import_lock:
        for patient in normalized_records:
            _imported_patients[patient.hadm_id] = patient

    summary = _build_import_summary(
        import_id=import_id,
        dataset_name=dataset_name,
        imported_at=imported_at,
        stored_path=str(stored_path),
        normalized_records=normalized_records,
    )

    return {
        "import_id": summary.import_id,
        "dataset_name": summary.dataset_name,
        "imported_at": summary.imported_at,
        "stored_path": summary.stored_path,
        "patient_count": summary.patient_count,
        "hadm_ids": summary.hadm_ids,
        "record_counts": summary.record_counts,
    }


def import_clinical_csv_data(request: ClinicalDataCsvImportRequest) -> dict[str, Any]:
    normalized_request = _build_bundle_from_csv_request(request)
    return import_clinical_data(normalized_request)


def import_clinical_excel_data(request: ClinicalDataExcelImportRequest) -> dict[str, Any]:
    normalized_request = _build_bundle_from_excel_request(request)
    return import_clinical_data(normalized_request)
