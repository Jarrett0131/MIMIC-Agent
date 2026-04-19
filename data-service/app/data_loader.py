from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.config import CHARTEVENTS_NROWS, DATA_DIR


def _read_csv(path: Path, **kwargs: object) -> pd.DataFrame:
    if not path.exists():
        print(f"[DataLoader] missing file: {path}")
        return pd.DataFrame()

    try:
        dataframe = pd.read_csv(
            path,
            compression="gzip",
            low_memory=False,
            **kwargs,
        )
    except Exception as exc:
        print(f"[DataLoader] failed to read {path}: {exc}")
        return pd.DataFrame()

    dataframe.columns = [str(column).strip() for column in dataframe.columns]
    return dataframe


class DataLoader:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        chartevents_nrows: int | None = CHARTEVENTS_NROWS,
    ) -> None:
        hosp_dir = data_dir / "hosp"
        icu_dir = data_dir / "icu"

        self.patients = self._load_table("patients", hosp_dir / "patients.csv.gz")
        self.admissions = self._load_table("admissions", hosp_dir / "admissions.csv.gz")
        self.diagnoses_icd = self._load_table(
            "diagnoses_icd",
            hosp_dir / "diagnoses_icd.csv.gz",
        )
        self.labevents = self._load_table("labevents", hosp_dir / "labevents.csv.gz")
        self.d_labitems = self._load_table("d_labitems", hosp_dir / "d_labitems.csv.gz")
        self.icustays = self._load_table("icustays", icu_dir / "icustays.csv.gz")
        self.chartevents = self._load_table(
            "chartevents",
            icu_dir / "chartevents.csv.gz",
            nrows=chartevents_nrows,
        )
        self.d_items = self._load_table("d_items", icu_dir / "d_items.csv.gz")

    @staticmethod
    def _print_shape(name: str, dataframe: pd.DataFrame) -> None:
        print(f"[DataLoader] {name}: shape={dataframe.shape}")

    def _load_table(
        self,
        name: str,
        path: Path,
        **kwargs: object,
    ) -> pd.DataFrame:
        dataframe = _read_csv(path, **kwargs)
        self._print_shape(name, dataframe)
        return dataframe


data_loader = DataLoader()
