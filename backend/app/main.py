"""
FastAPI 应用入口：注册路由与 CORS。

启动方式（在 backend 目录下）：
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ask import router as ask_router
from app.api.patient import router as patient_router
from app.config import settings

app = FastAPI(title=settings.api_title, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patient_router)
app.include_router(ask_router)


@app.get("/health")
def health() -> dict[str, str]:
    """简单健康检查。"""
    return {"status": "ok"}
