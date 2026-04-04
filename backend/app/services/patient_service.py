"""
患者与入院相关查询：根据 hadm_id 关联 patients、admissions、icustays。

仅返回结构化字段，不生成自然语言。

【需要根据实际 CSV 列名调整】
- MIMIC-IV patients 表常用 subject_id, gender, anchor_age；若 Demo 使用 age 列请改 _pick_patient_age。
- admissions 常用 admittime, dischtime；列名大小写需与 CSV 一致。
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.data_loader import get_admissions, get_icustays, get_patients


def _pick_patient_age(row: pd.Series) -> int | None:
    """从患者行中取年龄字段（不同版本列名可能不同）。"""
    # 【需要根据实际 CSV 列名调整】
    for col in ("anchor_age", "age"):
        if col in row.index and pd.notna(row[col]):
            try:
                return int(row[col])
            except (TypeError, ValueError):
                return None
    return None


def get_subject_id_for_hadm(hadm_id: int) -> int | None:
    """由 hadm_id 解析 subject_id。"""
    adm = get_admissions()
    if adm.empty or "hadm_id" not in adm.columns:
        return None
    sub = adm.loc[adm["hadm_id"] == hadm_id]
    if sub.empty or "subject_id" not in sub.columns:
        return None
    val = sub.iloc[0]["subject_id"]
    return int(val) if pd.notna(val) else None


def get_admission_times(hadm_id: int) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    """返回 (admittime, dischtime)。"""
    adm = get_admissions()
    if adm.empty or "hadm_id" not in adm.columns:
        return None, None
    sub = adm.loc[adm["hadm_id"] == hadm_id]
    if sub.empty:
        return None, None
    row = sub.iloc[0]
    admittime = pd.to_datetime(row["admittime"], errors="coerce") if "admittime" in row.index else pd.NaT
    dischtime = pd.to_datetime(row["dischtime"], errors="coerce") if "dischtime" in row.index else pd.NaT
    a = admittime if pd.notna(admittime) else None
    d = dischtime if pd.notna(dischtime) else None
    return a, d


def get_anchor_start_for_hadm(hadm_id: int) -> pd.Timestamp | None:
    """
    “最近 24 小时”窗口起点：优先该次入院的第一条 ICU intime，否则用 admittime。
    """
    icu = get_icustays()
    if not icu.empty and "hadm_id" in icu.columns and "intime" in icu.columns:
        sub = icu.loc[icu["hadm_id"] == hadm_id].copy()
        if not sub.empty:
            sub["_intime"] = pd.to_datetime(sub["intime"], errors="coerce")
            sub = sub.dropna(subset=["_intime"])
            if not sub.empty:
                return sub["_intime"].min()
    admittime, _ = get_admission_times(hadm_id)
    return admittime


def get_patient_demographics(subject_id: int) -> dict[str, Any]:
    """根据 subject_id 取性别、年龄等。"""
    pat = get_patients()
    if pat.empty or "subject_id" not in pat.columns:
        return {}
    sub = pat.loc[pat["subject_id"] == subject_id]
    if sub.empty:
        return {}
    row = sub.iloc[0]
    gender = row["gender"] if "gender" in row.index else None
    if pd.isna(gender):
        gender = None
    else:
        gender = str(gender)
    age = _pick_patient_age(row)
    return {"gender": gender, "anchor_age": age}


def build_patient_panel(hadm_id: int) -> dict[str, Any]:
    """
    组装 GET /patient 所需结构化数据：概览 + ICU 列表 + 诊断（诊断可委托 diagnosis_service，此处由 API 组合）。
    本函数仅负责患者/入院/ICU 部分。
    """
    adm = get_admissions()
    if adm.empty or "hadm_id" not in adm.columns:
        return {"found": False, "hadm_id": hadm_id}

    adm_row = adm.loc[adm["hadm_id"] == hadm_id]
    if adm_row.empty:
        return {"found": False, "hadm_id": hadm_id}

    row = adm_row.iloc[0]
    subject_id = int(row["subject_id"]) if "subject_id" in row.index and pd.notna(row["subject_id"]) else None
    demo: dict[str, Any] = {"found": True, "hadm_id": hadm_id, "subject_id": subject_id}
    admittime, dischtime = get_admission_times(hadm_id)
    demo["admittime"] = admittime.isoformat() if admittime is not None else None
    demo["dischtime"] = dischtime.isoformat() if dischtime is not None else None

    if subject_id is not None:
        demo.update(get_patient_demographics(subject_id))

    icu = get_icustays()
    stays: list[dict[str, Any]] = []
    if not icu.empty and "hadm_id" in icu.columns:
        icu_sub = icu.loc[icu["hadm_id"] == hadm_id]
        for _, ir in icu_sub.iterrows():
            item: dict[str, Any] = {}
            if "stay_id" in ir.index and pd.notna(ir["stay_id"]):
                item["stay_id"] = int(ir["stay_id"])
            if "intime" in ir.index:
                t = pd.to_datetime(ir["intime"], errors="coerce")
                item["intime"] = t.isoformat() if pd.notna(t) else None
            if "outtime" in ir.index:
                t = pd.to_datetime(ir["outtime"], errors="coerce")
                item["outtime"] = t.isoformat() if pd.notna(t) else None
            if "los" in ir.index and pd.notna(ir["los"]):
                try:
                    item["los"] = float(ir["los"])
                except (TypeError, ValueError):
                    item["los"] = None
            else:
                item["los"] = None
            stays.append(item)
    demo["icu_stays"] = stays
    return demo
