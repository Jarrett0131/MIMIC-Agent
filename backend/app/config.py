"""
应用配置：项目根目录、MIMIC Demo 数据目录、API/CORS。

路径均相对本文件解析，不写死机器绝对路径；可通过环境变量 MIMIC_DATA_DIR 覆盖 data_dir。
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# 项目根目录：backend/app/config.py -> parents[2] == 仓库根（含 data/、backend/）
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent

# MIMIC-IV Demo 数据根目录（默认 data/mimic_demo）
DATA_DIR: Path = PROJECT_ROOT / "data" / "mimic_demo"


class Settings(BaseSettings):
    """从环境变量加载配置；data_dir 默认 DATA_DIR。"""

    model_config = SettingsConfigDict(
        env_prefix="MIMIC_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    project_root: Path = Field(default=PROJECT_ROOT)
    data_dir: Path = Field(default=DATA_DIR)

    api_title: str = "MIMIC-IV Demo Clinical Q&A API"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()
