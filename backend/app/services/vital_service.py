"""
生命体征查询：chartevents 表，按 hadm_id + 时间窗 + itemid 过滤。

仅返回结构化记录列表。

【需要根据实际 CSV 列名调整】
- chartevents 需含 hadm_id, charttime, itemid；部分安装含 stay_id。
- itemid 需与 d_items 对照；下列为 MIMIC-IV 常见示例，**请用本地数据核对**。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import get_chartevents
from app.services.patient_service import get_anchor_start_for_hadm

# 【需要根据实际 CSV 列名调整 / 根据 d_items 核对 itemid】
VITAL_ITEMIDS: dict[str, list[int]] = {
    "heart_rate": [220045],
    "nbp_systolic": [220050, 220179],
    "nbp_diastolic": [220051, 220180],
    "temperature": [223761, 223762, 678],
}


def query_vital_last_24h(hadm_id: int, metric: str) -> list[dict[str, Any]]:
    """
    查询锚点后 24 小时内的生命体征。

    metric: heart_rate | nbp_systolic | nbp_diastolic | temperature
    血压综合问法在 router/generator 层合并 systolic/diastolic 两次查询。
    """
    itemids = VITAL_ITEMIDS.get(metric, [])
    if not itemids:
        return []

    anchor = get_anchor_start_for_hadm(hadm_id)
    if anchor is None:
        return []

    window_end = anchor + pd.Timedelta(hours=24)
    ch = get_chartevents()
    if ch.empty:
        return []
    required = {"hadm_id", "charttime", "itemid"}
    if not required.issubset(set(ch.columns)):
        return []

    sub = ch.loc[ch["hadm_id"] == hadm_id].copy()
    if sub.empty:
        return []

    sub["_charttime"] = pd.to_datetime(sub["charttime"], errors="coerce")
    sub = sub.dropna(subset=["_charttime"])
    sub = sub.loc[sub["_charttime"].between(anchor, window_end, inclusive="both")]
    sub = sub.loc[sub["itemid"].isin(itemids)]
    sub = sub.sort_values("_charttime", ascending=False)

    cols = [c for c in ("charttime", "stay_id", "itemid", "value", "valuenum", "valueuom") if c in sub.columns]
    if not cols:
        cols = [c for c in sub.columns if c != "_charttime"]

    out: list[dict[str, Any]] = []
    for _, row in sub.iterrows():
        rec: dict[str, Any] = {}
        ct = row["_charttime"]
        rec["charttime"] = ct.isoformat() if pd.notna(ct) else None
        for c in cols:
            v = row[c]
            if pd.isna(v):
                rec[c] = None
            elif c == "itemid" or c == "stay_id":
                try:
                    rec[c] = int(v)
                except (TypeError, ValueError):
                    rec[c] = None
            elif c == "valuenum" and pd.notna(v):
                try:
                    rec[c] = float(v)
                except (TypeError, ValueError):
                    rec[c] = str(v)
            else:
                rec[c] = str(v) if not isinstance(v, (int, float)) else v
        out.append(rec)
    return out
