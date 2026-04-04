"""
数据加载模块：从本地 CSV 读取 MIMIC-IV Demo 各表，并在进程内缓存 DataFrame。

职责：
- 统一解析路径、读取 CSV
- 缓存避免重复 IO
- 不负责业务查询逻辑

【需要根据实际 CSV 列名调整】
若 CSV 使用不同分隔符或编码，可在此增加 read_csv 参数（sep、encoding）。
MIMIC 官方通常为逗号分隔 UTF-8。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

import pandas as pd

from app.config import settings

if TYPE_CHECKING:
    pass


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    # 【需要根据实际 CSV 列名调整】如列名带 BOM，可在此 strip columns
    df = pd.read_csv(path, low_memory=False)
    df.columns = [str(c).strip() for c in df.columns]
    return df


@lru_cache(maxsize=1)
def get_patients() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_patients)


@lru_cache(maxsize=1)
def get_admissions() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_admissions)


@lru_cache(maxsize=1)
def get_icustays() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_icustays)


@lru_cache(maxsize=1)
def get_labevents() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_labevents)


@lru_cache(maxsize=1)
def get_chartevents() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_chartevents)


@lru_cache(maxsize=1)
def get_diagnoses_icd() -> pd.DataFrame:
    return _read_csv(settings.data_dir / settings.file_diagnoses_icd)


def clear_cache() -> None:
    """测试或热重载时可调用以清空缓存（一般不需要）。"""
    get_patients.cache_clear()
    get_admissions.cache_clear()
    get_icustays.cache_clear()
    get_labevents.cache_clear()
    get_chartevents.cache_clear()
    get_diagnoses_icd.cache_clear()
