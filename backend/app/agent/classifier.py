"""
规则问题分类（不接 LLM）。匹配顺序自上而下，命中即返回。
"""

from __future__ import annotations


def classify_question(question: str) -> str:
    q_raw = question.strip()
    q = q_raw.lower()

    # 1. 基本信息 / 住院 / ICU
    overview_kw = (
        "年龄",
        "性别",
        "基本信息",
        "住院信息",
        "icu",
    )
    if any(k in q_raw for k in overview_kw if k != "icu") or "icu" in q:
        return "overview"

    # 2. 诊断
    if "诊断" in q_raw or "疾病" in q_raw:
        return "diagnosis"

    # 3. 乳酸
    if "乳酸" in q_raw or "lactate" in q:
        return "lab_lactate"

    # 4. 肌酐
    if "肌酐" in q_raw or "creatinine" in q:
        return "lab_creatinine"

    # 5. 白细胞
    if "白细胞" in q_raw or "white" in q:
        return "lab_white"

    # 6. 心率
    if "心率" in q_raw or "heart rate" in q:
        return "vital_heart_rate"

    # 7. 血压
    if "血压" in q_raw or "blood pressure" in q:
        return "vital_blood_pressure"

    return "unsupported"
