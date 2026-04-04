"""
诊断查询：基于 diagnoses_icd 表按 hadm_id 取 ICD 记录。

仅返回结构化列表，不生成自然语言。

【需要根据实际 CSV 列名调整】
diagnoses_icd 标准列为 seq_num, icd_code, icd_version；若 Demo 列名不同请同步修改。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import get_diagnoses_icd


def list_diagnoses_for_hadm(hadm_id: int) -> list[dict[str, Any]]:
    """返回该次入院的所有诊断记录，按 seq_num 排序（若存在）。"""
    dx = get_diagnoses_icd()
    if dx.empty or "hadm_id" not in dx.columns:
        return []
    sub = dx.loc[dx["hadm_id"] == hadm_id].copy()
    if sub.empty:
        return []
    if "seq_num" in sub.columns:
        sub = sub.sort_values("seq_num", kind="mergesort")
    out: list[dict[str, Any]] = []
    for _, row in sub.iterrows():
        rec: dict[str, Any] = {}
        if "seq_num" in row.index and pd.notna(row["seq_num"]):
            try:
                rec["seq_num"] = int(row["seq_num"])
            except (TypeError, ValueError):
                rec["seq_num"] = None
        else:
            rec["seq_num"] = None
        if "icd_code" in row.index and pd.notna(row["icd_code"]):
            rec["icd_code"] = str(row["icd_code"]).strip()
        else:
            rec["icd_code"] = None
        if "icd_version" in row.index and pd.notna(row["icd_version"]):
            try:
                rec["icd_version"] = int(row["icd_version"])
            except (TypeError, ValueError):
                rec["icd_version"] = None
        else:
            rec["icd_version"] = None
        out.append(rec)
    return out
