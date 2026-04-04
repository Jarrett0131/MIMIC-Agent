"""
问题分类器：纯规则匹配用户问题所属类型（不接 LLM）。

类型与课程要求一致：
- overview: 患者基本信息
- diagnosis: 诊断信息
- lab: 实验室指标
- vital: 生命体征

匹配优先级：先匹配更具体的实验室/体征关键词，再诊断，再基本信息。

QuestionType 定义见 app.schemas，与 AskResponse.question_type、前端类型保持一致。
"""

from __future__ import annotations

from app.schemas import QuestionType


def classify_question(question: str) -> QuestionType:
    """根据关键词规则返回问题类型；无法识别则为 unknown。"""
    q = question.strip().lower()

    # 实验室指标（示例：乳酸、白细胞、肌酐）
    lab_keywords = ("乳酸", "白细胞", "肌酐", "化验", "检验", "实验室", "lab")
    if any(k.lower() in q for k in lab_keywords):
        return "lab"

    # 生命体征（示例：心率、血压、体温）
    vital_keywords = ("心率", "血压", "体温", "生命体征", "脉搏")
    if any(k.lower() in q for k in vital_keywords):
        return "vital"

    # 诊断
    diagnosis_keywords = ("诊断", "icd", "疾病编码")
    if any(k.lower() in q for k in diagnosis_keywords):
        return "diagnosis"

    # 基本信息
    overview_keywords = (
        "基本信息",
        "年龄",
        "性别",
        "入院",
        "患者",
        "是谁",
        "概况",
        "资料",
    )
    if any(k.lower() in q for k in overview_keywords):
        return "overview"

    return "unknown"
