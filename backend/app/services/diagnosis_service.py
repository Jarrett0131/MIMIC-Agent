"""
诊断列表：diagnoses_icd。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import data_loader


def _record_clean(row: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        if pd.isna(v):
            out[str(k)] = None
        elif hasattr(v, "isoformat"):
            try:
                out[str(k)] = v.isoformat()
            except (TypeError, ValueError):
                out[str(k)] = str(v)
        else:
            out[str(k)] = v
    return out


def get_diagnoses(hadm_id: int) -> list[dict[str, Any]]:
    """筛选 hadm_id，最多返回 10 条；无数据返回 []。"""
    dx = data_loader.diagnoses_icd
    if dx.empty or "hadm_id" not in dx.columns:
        return []

    sub = dx.loc[dx["hadm_id"] == hadm_id]
    if sub.empty:
        return []

    # TODO: ICD 列名可能是 icd_code / icd9_code / icd10_code 等
    want = [
        c
        for c in ("subject_id", "hadm_id", "icd_code", "icd_version")
        if c in sub.columns
    ]
    if not want:
        sub = sub.head(10)
    else:
        sub = sub[want].head(10)

    return [_record_clean(sub.iloc[i]) for i in range(len(sub))]
