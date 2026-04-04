"""
实验室指标查询：labevents 表，按 hadm_id + 时间窗 + itemid 过滤。

仅返回结构化记录列表。

【需要根据实际 CSV 列名调整】
- labevents 必须有 hadm_id, charttime, itemid；数值列常为 valuenum, valueuom。
- 下列 itemid 为 MIMIC-IV 中常见示例，**务必用本地 d_labitems.csv 核对** Demo 子集是否包含这些 itemid；
  若不包含，查询结果为空属正常，请按实际 itemid 修改 LAB_ITEMIDS。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import get_labevents
from app.services.patient_service import get_anchor_start_for_hadm

# 关键词 -> 候选 itemid 列表（需与本地数据字典一致）
# 【需要根据实际 CSV 列名调整 / 根据 d_labitems 核对 itemid】
LAB_ITEMIDS: dict[str, list[int]] = {
    "lactate": [50813, 52442],
    "wbc": [51301, 51733, 52069],
    "creatinine": [50912, 220615],
}


def query_lab_last_24h(hadm_id: int, metric: str) -> list[dict[str, Any]]:
    """
    查询入院/ICU 锚点后 24 小时内的实验室记录。

    metric: lactate | wbc | creatinine
    """
    itemids = LAB_ITEMIDS.get(metric, [])
    if not itemids:
        return []

    anchor = get_anchor_start_for_hadm(hadm_id)
    if anchor is None:
        return []

    window_end = anchor + pd.Timedelta(hours=24)
    lab = get_labevents()
    if lab.empty:
        return []
    required = {"hadm_id", "charttime", "itemid"}
    if not required.issubset(set(lab.columns)):
        return []

    sub = lab.loc[lab["hadm_id"] == hadm_id].copy()
    if sub.empty:
        return []

    sub["_charttime"] = pd.to_datetime(sub["charttime"], errors="coerce")
    sub = sub.dropna(subset=["_charttime"])
    sub = sub.loc[sub["_charttime"].between(anchor, window_end, inclusive="both")]
    sub = sub.loc[sub["itemid"].isin(itemids)]

    sub = sub.sort_values("_charttime", ascending=False)

    prefer_cols = ("itemid", "value", "valuenum", "valueuom", "flag")
    out: list[dict[str, Any]] = []
    for _, row in sub.iterrows():
        rec: dict[str, Any] = {}
        ct = row["_charttime"]
        rec["charttime"] = ct.isoformat() if pd.notna(ct) else None
        for c in prefer_cols:
            if c not in sub.columns:
                continue
            v = row[c]
            if pd.isna(v):
                rec[c] = None
            elif c == "itemid":
                try:
                    rec[c] = int(v)
                except (TypeError, ValueError):
                    rec[c] = None
            elif c == "valuenum":
                try:
                    rec[c] = float(v)
                except (TypeError, ValueError):
                    rec[c] = str(v)
            else:
                rec[c] = str(v) if not isinstance(v, (int, float)) else v
        out.append(rec)
    return out
