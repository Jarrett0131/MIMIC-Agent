"""
应用配置：数据目录、表文件名、CORS 等。

【需要根据实际 CSV 列名调整】
若本地文件名与 MIMIC-IV Demo 发布包不一致，请修改 TABLE_FILES。
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """从环境变量加载配置，便于本地与演示环境切换。"""

    model_config = SettingsConfigDict(
        env_prefix="MIMIC_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 存放 MIMIC-IV Demo CSV 的根目录（相对 backend 或绝对路径均可）
    data_dir: Path = Path(__file__).resolve().parent.parent.parent / "data" / "mimic_demo"

    # 各表 CSV 文件名（不含路径）
    # 【需要根据实际 CSV 列名调整】若表名不同，在此改文件名
    file_patients: str = "patients.csv"
    file_admissions: str = "admissions.csv"
    file_icustays: str = "icustays.csv"
    file_labevents: str = "labevents.csv"
    file_chartevents: str = "chartevents.csv"
    file_diagnoses_icd: str = "diagnoses_icd.csv"

    # API
    api_title: str = "MIMIC-IV Demo Clinical Q&A API"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()
