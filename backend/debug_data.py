"""
独立数据验证脚本。

用法（在 backend 目录下）:
    python debug_data.py
"""

from __future__ import annotations

import pprint

from app.data_loader import data_loader
from app.services.diagnosis_service import get_diagnoses
from app.services.feature_probe_service import probe_patient_features
from app.services.lab_service import get_labs_by_keyword
from app.services.patient_service import get_patient_overview
from app.services.vital_service import get_vitals_by_keyword


def _banner(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def _subbanner(title: str) -> None:
    print()
    print("-" * 72)
    print(title)
    print("-" * 72)


def _print_dict_result(title: str, d: dict) -> None:
    _subbanner(title)
    n = len(d)
    print(f"键数量: {n}")
    if n == 0:
        print("状态: (空)")
    else:
        print("状态: 有数据")
        pprint.pprint(d, width=100, sort_dicts=False)


def _print_list_result(title: str, rows: list) -> None:
    _subbanner(title)
    print(f"条数: {len(rows)}")
    if not rows:
        print("状态: (空)")
        return
    print("状态: 有数据")
    for i, row in enumerate(rows):
        print(f"  --- [{i}] ---")
        pprint.pprint(row, width=100, sort_dicts=False)


def main() -> None:
    adm = data_loader.admissions
    if adm.empty or "hadm_id" not in adm.columns:
        print("admissions 为空或缺少 hadm_id，无法抽样。")
        return

    sample_hadm = adm["hadm_id"].drop_duplicates().head(10).tolist()

    _banner("Step 1 — admissions 中前 10 个（去重）hadm_id")
    for h in sample_hadm:
        print(f"  {h}")

    if not sample_hadm:
        print("\n无可用 hadm_id。")
        return

    hadm_id = int(sample_hadm[0])
    _banner(f"Step 2 — 测试样本 hadm_id = {hadm_id}")

    _subbanner("probe_patient_features(hadm_id)")
    probe = probe_patient_features(hadm_id)
    pprint.pprint(probe, width=100, sort_dicts=False)

    _banner("Step 3 — 明细查询（用于核对 probe 与各函数是否一致）")

    _print_dict_result("get_patient_overview(hadm_id)", get_patient_overview(hadm_id))
    _print_list_result("get_diagnoses(hadm_id)", get_diagnoses(hadm_id))
    _print_list_result(
        'get_labs_by_keyword(hadm_id, "lactate")',
        get_labs_by_keyword(hadm_id, "lactate"),
    )
    _print_list_result(
        'get_labs_by_keyword(hadm_id, "creatinine")',
        get_labs_by_keyword(hadm_id, "creatinine"),
    )
    _print_list_result(
        'get_labs_by_keyword(hadm_id, "white")',
        get_labs_by_keyword(hadm_id, "white"),
    )
    _print_list_result(
        'get_vitals_by_keyword(hadm_id, "heart rate")',
        get_vitals_by_keyword(hadm_id, "heart rate"),
    )
    _print_list_result(
        'get_vitals_by_keyword(hadm_id, "blood pressure")',
        get_vitals_by_keyword(hadm_id, "blood pressure"),
    )

    print()


if __name__ == "__main__":
    main()
