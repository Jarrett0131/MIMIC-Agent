"""
数据加载：从 data/mimic-demo 下 .csv.gz 读入 pandas DataFrame。

仅负责 IO 与缓存实例；业务查询在 services 中实现。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from app.config import settings


def _read_gz_csv(path: Path, **kwargs: Any) -> pd.DataFrame:
    if not path.exists():
        print(f"[DataLoader] 缺失文件: {path}")
        return pd.DataFrame()
    # TODO: 若分隔符/编码非默认，可在此增加 sep、encoding
    df = pd.read_csv(path, compression="gzip", low_memory=False, **kwargs)
    df.columns = [str(c).strip() for c in df.columns]
    return df


class DataLoader:
    """
    初始化时加载 8 张表；chartevents 可通过 chart_nrows 限制行数以控制内存。
    """

    def __init__(self, chart_nrows: int | None = 200_000) -> None:
        root: Path = settings.data_dir
        hosp = root / "hosp"
        icu = root / "icu"

        self.patients: pd.DataFrame = _read_gz_csv(hosp / "patients.csv.gz")
        self._print_shape("patients", self.patients)

        self.admissions: pd.DataFrame = _read_gz_csv(hosp / "admissions.csv.gz")
        self._print_shape("admissions", self.admissions)

        self.diagnoses_icd: pd.DataFrame = _read_gz_csv(hosp / "diagnoses_icd.csv.gz")
        self._print_shape("diagnoses_icd", self.diagnoses_icd)

        self.labevents: pd.DataFrame = _read_gz_csv(hosp / "labevents.csv.gz")
        self._print_shape("labevents", self.labevents)

        self.d_labitems: pd.DataFrame = _read_gz_csv(hosp / "d_labitems.csv.gz")
        self._print_shape("d_labitems", self.d_labitems)

        self.icustays: pd.DataFrame = _read_gz_csv(icu / "icustays.csv.gz")
        self._print_shape("icustays", self.icustays)

        chart_kwargs: dict[str, Any] = {}
        if chart_nrows is not None:
            chart_kwargs["nrows"] = chart_nrows
        self.chartevents: pd.DataFrame = _read_gz_csv(
            icu / "chartevents.csv.gz", **chart_kwargs
        )
        self._print_shape("chartevents", self.chartevents)

        self.d_items: pd.DataFrame = _read_gz_csv(icu / "d_items.csv.gz")
        self._print_shape("d_items", self.d_items)

    @staticmethod
    def _print_shape(name: str, df: pd.DataFrame) -> None:
        print(f"[DataLoader] {name}: shape={df.shape}")


# 进程内全局单例，供 services / 调试脚本复用
data_loader = DataLoader()
