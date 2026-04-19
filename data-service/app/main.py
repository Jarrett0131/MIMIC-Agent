from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.diagnoses import router as diagnoses_router
from app.api.imports import router as imports_router
from app.api.labs import router as labs_router
from app.api.patient import router as patient_router
from app.api.patients import router as patients_router
from app.api.vitals import router as vitals_router
from app.config import LOCALHOST_ORIGINS

app = FastAPI(title="MIMIC-IV Demo Data Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCALHOST_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patient_router)
app.include_router(patients_router)
app.include_router(diagnoses_router)
app.include_router(labs_router)
app.include_router(vitals_router)
app.include_router(imports_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
