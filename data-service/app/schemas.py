from __future__ import annotations

from pydantic import BaseModel, Field


class PatientOverview(BaseModel):
    subject_id: int | None = None
    gender: str | None = None
    age: int | None = None
    admittime: str | None = None
    dischtime: str | None = None
    admission_type: str | None = None
    admission_location: str | None = None
    discharge_location: str | None = None
    race: str | None = None
    icu_stay_id: int | None = None
    icu_intime: str | None = None
    icu_outtime: str | None = None


class DiagnosisRecord(BaseModel):
    subject_id: int | None = None
    hadm_id: int | None = None
    seq_num: int | None = None
    icd_code: str | None = None
    icd_version: int | None = None


class LabRecord(BaseModel):
    subject_id: int | None = None
    hadm_id: int | None = None
    itemid: int | None = None
    label: str | None = None
    charttime: str | None = None
    value: str | None = None
    valuenum: float | None = None
    valueuom: str | None = None
    flag: str | None = None


class VitalRecord(BaseModel):
    subject_id: int | None = None
    hadm_id: int | None = None
    stay_id: int | None = None
    itemid: int | None = None
    label: str | None = None
    charttime: str | None = None
    value: str | None = None
    valuenum: float | None = None
    valueuom: str | None = None
    warning: int | None = None


class PatientOverviewResponse(BaseModel):
    hadm_id: int
    patient_overview: PatientOverview = Field(default_factory=PatientOverview)
    diagnoses: list[DiagnosisRecord] = Field(default_factory=list)


class PatientIdListResponse(BaseModel):
    hadm_ids: list[int] = Field(default_factory=list)
    total: int = 0


class DiagnosesResponse(BaseModel):
    hadm_id: int
    diagnoses: list[DiagnosisRecord] = Field(default_factory=list)


class LabRecordsResponse(BaseModel):
    hadm_id: int
    keyword: str
    records: list[LabRecord] = Field(default_factory=list)


class VitalRecordsResponse(BaseModel):
    hadm_id: int
    keyword: str
    records: list[VitalRecord] = Field(default_factory=list)


class ExternalClinicalMetadata(BaseModel):
    name: str | None = None
    source: str | None = None
    description: str | None = None


class ImportedClinicalPatient(BaseModel):
    hadm_id: int
    patient_overview: PatientOverview = Field(default_factory=PatientOverview)
    diagnoses: list[DiagnosisRecord] = Field(default_factory=list)
    labs: list[LabRecord] = Field(default_factory=list)
    vitals: list[VitalRecord] = Field(default_factory=list)


class ClinicalDataBundle(BaseModel):
    metadata: ExternalClinicalMetadata = Field(default_factory=ExternalClinicalMetadata)
    patients: list[ImportedClinicalPatient] = Field(default_factory=list)


class ClinicalDataImportRequest(BaseModel):
    dataset_name: str | None = None
    bundle: ClinicalDataBundle


class ClinicalDataCsvBundle(BaseModel):
    patients_csv: str
    diagnoses_csv: str | None = None
    labs_csv: str | None = None
    vitals_csv: str | None = None


class ClinicalDataCsvImportRequest(BaseModel):
    dataset_name: str | None = None
    csv_bundle: ClinicalDataCsvBundle


class ClinicalDataExcelBundle(BaseModel):
    workbook_base64: str
    workbook_name: str | None = None


class ClinicalDataExcelImportRequest(BaseModel):
    dataset_name: str | None = None
    excel_bundle: ClinicalDataExcelBundle


class ClinicalDataImportRecordCounts(BaseModel):
    diagnoses: int = 0
    labs: int = 0
    vitals: int = 0


class ClinicalDataImportResponse(BaseModel):
    import_id: str
    dataset_name: str
    imported_at: str
    stored_path: str
    patient_count: int
    hadm_ids: list[int] = Field(default_factory=list)
    record_counts: ClinicalDataImportRecordCounts = Field(
        default_factory=ClinicalDataImportRecordCounts
    )


class ClinicalDataImportListResponse(BaseModel):
    items: list[ClinicalDataImportResponse] = Field(default_factory=list)
    total: int = 0
