"""
患者概览：admissions + patients + icustays。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import data_loader


def _scalar_or_none(val: Any) -> Any:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat()
        except (TypeError, ValueError):
            return str(val)
    return val


def get_patient_overview(hadm_id: int) -> dict[str, Any]:
    """
    根据 hadm_id 汇总入院、患者维度、（按 intime 最早一条）ICU 时间。
    查无入院记录时返回 {}。
    """
    adm = data_loader.admissions
    if adm.empty or "hadm_id" not in adm.columns:
        return {}

    sub = adm.loc[adm["hadm_id"] == hadm_id]
    if sub.empty:
        return {}

    row = sub.iloc[0]
    # TODO: 列名可能随 MIMIC 版本变化，常见为 subject_id
    if "subject_id" not in row.index or pd.isna(row["subject_id"]):
        return {}
    subject_id = int(row["subject_id"])

    gender: str | None = None
    age: int | None = None
    pat = data_loader.patients
    if not pat.empty and "subject_id" in pat.columns:
        pr = pat.loc[pat["subject_id"] == subject_id]
        if not pr.empty:
            p0 = pr.iloc[0]
            # TODO: 性别列名可能是 gender / gndr 等
            if "gender" in p0.index and pd.notna(p0["gender"]):
                gender = str(p0["gender"])
            # TODO: 年龄列名可能是 anchor_age / age 等
            for age_col in ("anchor_age", "age"):
                if age_col in p0.index and pd.notna(p0[age_col]):
                    try:
                        age = int(p0[age_col])
                    except (TypeError, ValueError):
                        age = None
                    break

    admittime = row["admittime"] if "admittime" in row.index else None
    dischtime = row["dischtime"] if "dischtime" in row.index else None

    icu_intime: Any = None
    icu_outtime: Any = None
    icu = data_loader.icustays
    if not icu.empty and "hadm_id" in icu.columns and "intime" in icu.columns:
        icu_sub = icu.loc[icu["hadm_id"] == hadm_id].copy()
        if not icu_sub.empty:
            icu_sub["_intime_parsed"] = pd.to_datetime(
                icu_sub["intime"], errors="coerce"
            )
            icu_sub = icu_sub.sort_values("_intime_parsed", kind="mergesort")
            i0 = icu_sub.iloc[0]
            icu_intime = i0["intime"] if "intime" in i0.index else None
            icu_outtime = i0["outtime"] if "outtime" in i0.index else None

    return {
        "subject_id": subject_id,
        "gender": gender,
        "age": age,
        "admittime": _scalar_or_none(admittime),
        "dischtime": _scalar_or_none(dischtime),
        "icu_intime": _scalar_or_none(icu_intime),
        "icu_outtime": _scalar_or_none(icu_outtime),
    }
