"""
生命体征：chartevents 左连 d_items，按 label 关键词筛选。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import data_loader


def _nan_to_none(val: Any) -> Any:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat()
        except (TypeError, ValueError):
            return str(val)
    return val


def get_vitals_by_keyword(
    hadm_id: int, keyword: str, limit: int = 20
) -> list[dict[str, Any]]:
    """
    chartevents ⋊ d_items(itemid)，hadm_id 匹配且 label 包含 keyword（大小写不敏感）。
    """
    ch = data_loader.chartevents
    dic = data_loader.d_items
    if ch.empty or dic.empty:
        return []
    if "itemid" not in ch.columns or "itemid" not in dic.columns:
        return []
    if "hadm_id" not in ch.columns:
        return []

    # TODO: d_items 中项目名称列可能是 label / abbreviation 等
    label_col = "label" if "label" in dic.columns else None
    if label_col is None:
        return []

    dic_sub = dic[["itemid", label_col]].drop_duplicates(subset=["itemid"], keep="first")
    merged = ch.merge(dic_sub, on="itemid", how="left")
    merged = merged.loc[merged["hadm_id"] == hadm_id]
    if merged.empty:
        return []

    labels = merged[label_col].fillna("").astype(str)
    kw = keyword.lower()
    mask = labels.str.lower().str.contains(kw, regex=False, na=False)
    merged = merged.loc[mask].head(limit)

    desired = [
        "subject_id",
        "hadm_id",
        "itemid",
        "label",
        "charttime",
        "valuenum",
        "valueuom",
    ]
    rows: list[dict[str, Any]] = []
    for _, row in merged.iterrows():
        rec: dict[str, Any] = {}
        for c in desired:
            src = label_col if c == "label" else c
            if src not in row.index:
                rec[c] = None
            else:
                rec[c] = _nan_to_none(row[src])
        rows.append(rec)
    return rows
