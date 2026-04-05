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


DESIRED_VITAL_COLS = [
    "subject_id",
    "hadm_id",
    "itemid",
    "label",
    "charttime",
    "valuenum",
    "valueuom",
]


def _merged_vitals_for_keyword(hadm_id: int, keyword: str) -> tuple[pd.DataFrame, str] | tuple[pd.DataFrame, None]:
    """chartevents ⋊ d_items，按 hadm_id 与 label 关键词过滤。"""
    ch = data_loader.chartevents
    dic = data_loader.d_items
    if ch.empty or dic.empty:
        return pd.DataFrame(), None
    if "itemid" not in ch.columns or "itemid" not in dic.columns:
        return pd.DataFrame(), None
    if "hadm_id" not in ch.columns:
        return pd.DataFrame(), None

    # TODO: d_items 中项目名称列可能是 label / abbreviation 等
    label_col = "label" if "label" in dic.columns else None
    if label_col is None:
        return pd.DataFrame(), None

    dic_sub = dic[["itemid", label_col]].drop_duplicates(subset=["itemid"], keep="first")
    merged = ch.merge(dic_sub, on="itemid", how="left")
    merged = merged.loc[merged["hadm_id"] == hadm_id]
    if merged.empty:
        return pd.DataFrame(), label_col

    labels = merged[label_col].fillna("").astype(str)
    kw = keyword.lower()
    mask = labels.str.lower().str.contains(kw, regex=False, na=False)
    merged = merged.loc[mask]
    return merged, label_col


def _vital_rows_from_df(merged: pd.DataFrame, label_col: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for _, row in merged.iterrows():
        rec: dict[str, Any] = {}
        for c in DESIRED_VITAL_COLS:
            src = label_col if c == "label" else c
            if src not in row.index:
                rec[c] = None
            else:
                rec[c] = _nan_to_none(row[src])
        rows.append(rec)
    return rows


def get_vitals_by_keyword(
    hadm_id: int, keyword: str, limit: int = 20
) -> list[dict[str, Any]]:
    """
    chartevents ⋊ d_items(itemid)，hadm_id 匹配且 label 包含 keyword（大小写不敏感）。
    """
    merged, label_col = _merged_vitals_for_keyword(hadm_id, keyword)
    if label_col is None or merged.empty:
        return []
    merged = merged.head(limit)
    return _vital_rows_from_df(merged, label_col)


def get_recent_vitals(hadm_id: int, keyword: str, limit: int = 10) -> list[dict[str, Any]]:
    """
    同关键词过滤后按 charttime 降序，取最近 limit 条。
    """
    merged, label_col = _merged_vitals_for_keyword(hadm_id, keyword)
    if label_col is None or merged.empty:
        return []
    if "charttime" not in merged.columns:
        return []

    work = merged.copy()
    work["_charttime_dt"] = pd.to_datetime(work["charttime"], errors="coerce")
    work = work.sort_values("_charttime_dt", ascending=False, na_position="last").head(limit)
    work = work.drop(columns=["_charttime_dt"], errors="ignore")
    return _vital_rows_from_df(work, label_col)
