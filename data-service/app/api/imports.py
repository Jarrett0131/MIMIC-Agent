from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import (
    ClinicalDataCsvImportRequest,
    ClinicalDataExcelImportRequest,
    ClinicalDataImportRequest,
    ClinicalDataImportListResponse,
    ClinicalDataImportResponse,
)
from app.services.import_service import (
    ClinicalDataImportError,
    ClinicalDataImportNotFoundError,
    ClinicalDataImportValidationError,
    delete_imported_dataset,
    import_clinical_csv_data,
    import_clinical_excel_data,
    import_clinical_data,
    list_imported_datasets,
)

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("/clinical-data", response_model=ClinicalDataImportListResponse)
def read_clinical_data_imports() -> ClinicalDataImportListResponse:
    items = list_imported_datasets()
    return ClinicalDataImportListResponse(items=items, total=len(items))


@router.post("/clinical-data", response_model=ClinicalDataImportResponse, status_code=201)
def create_clinical_data_import(
    payload: ClinicalDataImportRequest,
) -> ClinicalDataImportResponse:
    try:
        return ClinicalDataImportResponse(**import_clinical_data(payload))
    except ClinicalDataImportValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ClinicalDataImportError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/clinical-data/csv", response_model=ClinicalDataImportResponse, status_code=201)
def create_clinical_data_csv_import(
    payload: ClinicalDataCsvImportRequest,
) -> ClinicalDataImportResponse:
    try:
        return ClinicalDataImportResponse(**import_clinical_csv_data(payload))
    except ClinicalDataImportValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ClinicalDataImportError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/clinical-data/excel", response_model=ClinicalDataImportResponse, status_code=201)
def create_clinical_data_excel_import(
    payload: ClinicalDataExcelImportRequest,
) -> ClinicalDataImportResponse:
    try:
        return ClinicalDataImportResponse(**import_clinical_excel_data(payload))
    except ClinicalDataImportValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ClinicalDataImportError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.delete("/clinical-data/{import_id}", response_model=ClinicalDataImportResponse)
def remove_clinical_data_import(import_id: str) -> ClinicalDataImportResponse:
    try:
        return ClinicalDataImportResponse(**delete_imported_dataset(import_id))
    except ClinicalDataImportNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ClinicalDataImportValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ClinicalDataImportError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
