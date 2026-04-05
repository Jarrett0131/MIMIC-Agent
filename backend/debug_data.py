"""
独立数据验证脚本。

用法（在 backend 目录下）:
    python debug_data.py
"""

from __future__ import annotations

from app.data_loader import data_loader
from app.services.diagnosis_service import get_diagnoses
from app.services.lab_service import get_labs_by_keyword
from app.services.patient_service import get_patient_overview
from app.services.vital_service import get_vitals_by_keyword


def main() -> None:
    adm = data_loader.admissions
    if adm.empty or "hadm_id" not in adm.columns:
        print("admissions 为空或缺少 hadm_id，无法抽样。")
        return

    sample_hadm = adm["hadm_id"].drop_duplicates().head(10).tolist()
    print("=" * 60)
    print("admissions 中前 10 个（去重）hadm_id:")
    for h in sample_hadm:
        print(f"  {h}")
    print("=" * 60)

    if not sample_hadm:
        print("无可用 hadm_id。")
        return

    hadm_id = int(sample_hadm[0])
    print(f"\n>>> 使用测试 hadm_id = {hadm_id}\n")

    def block(title: str, obj: object) -> None:
        print("-" * 60)
        print(title)
        print("-" * 60)
        print(obj)
        print()

    block("get_patient_overview(hadm_id)", get_patient_overview(hadm_id))
    block("get_diagnoses(hadm_id)", get_diagnoses(hadm_id))
    block('get_labs_by_keyword(hadm_id, "lactate")', get_labs_by_keyword(hadm_id, "lactate"))
    block(
        'get_labs_by_keyword(hadm_id, "creatinine")',
        get_labs_by_keyword(hadm_id, "creatinine"),
    )
    block('get_labs_by_keyword(hadm_id, "white")', get_labs_by_keyword(hadm_id, "white"))
    block(
        'get_vitals_by_keyword(hadm_id, "heart rate")',
        get_vitals_by_keyword(hadm_id, "heart rate"),
    )
    block(
        'get_vitals_by_keyword(hadm_id, "blood pressure")',
        get_vitals_by_keyword(hadm_id, "blood pressure"),
    )


if __name__ == "__main__":
    main()
