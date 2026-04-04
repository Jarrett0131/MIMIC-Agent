"""
回答生成器：基于查询结果使用模板拼接自然语言，并整理 evidence。

约束：
- 仅使用传入的 records/panel 中的字段，不编造数值或诊断结论。
- 不提供诊疗建议，仅复述数据事实或说明未查到记录。

扩展点：可将模板函数替换为 LLM 调用，但应对 evidence 做同样约束（只引用查询结果）。
"""

from __future__ import annotations

from typing import Any

from app.agent.router import ToolRun
from app.schemas import AskResponse

LIMITATION_TEXT = (
    "本输出基于 MIMIC-IV Demo 结构化数据与规则查询，仅供教学演示；"
    "非临床决策依据，不包含诊断建议或治疗推荐。"
)


def _no_data_answer() -> str:
    return "未查询到相关记录。"


def _evidence_from_records(records: list[dict[str, Any]], max_items: int = 80) -> list[dict[str, Any]]:
    """截断证据条数，避免响应过大。"""
    return records[:max_items]


def generate_ask_response(run: ToolRun) -> AskResponse:
    """根据 ToolRun 生成统一格式的 AskResponse。"""
    qt = run.question_type
    evidence = _evidence_from_records(run.records)

    if qt == "unknown":
        return AskResponse(
            question_type="unknown",
            tool_called=run.tool_called,
            tool_args=run.tool_args,
            answer="当前问题无法匹配到已支持的类型（基本信息、诊断、实验室指标、生命体征）。请换一种问法。",
            evidence=[],
            limitation=LIMITATION_TEXT,
        )

    if qt == "overview":
        panel = run.records[0] if run.records else {}
        if not panel.get("found"):
            return AskResponse(
                question_type="overview",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer=_no_data_answer(),
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        parts: list[str] = [
            f"住院号 hadm_id={panel.get('hadm_id')}。",
        ]
        if panel.get("subject_id") is not None:
            parts.append(f"患者 subject_id={panel['subject_id']}。")
        if panel.get("gender"):
            parts.append(f"性别：{panel['gender']}。")
        if panel.get("anchor_age") is not None:
            parts.append(f"年龄（anchor_age）：{panel['anchor_age']}。")
        if panel.get("admittime"):
            parts.append(f"入院时间：{panel['admittime']}。")
        if panel.get("dischtime"):
            parts.append(f"出院时间：{panel['dischtime']}。")
        icu = panel.get("icu_stays") or []
        if icu:
            parts.append(f"ICU 入住记录数：{len(icu)}。")
        else:
            parts.append("本次入院未查询到 ICU 入住记录。")
        return AskResponse(
            question_type="overview",
            tool_called=run.tool_called,
            tool_args=run.tool_args,
            answer="\n".join(parts),
            evidence=evidence,
            limitation=LIMITATION_TEXT,
        )

    if qt == "diagnosis":
        if not run.records:
            return AskResponse(
                question_type="diagnosis",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer=_no_data_answer(),
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        lines: list[str] = ["本次入院查询到的诊断编码列表（按 seq_num 排序，仅陈述编码事实）："]
        for r in run.records:
            seq = r.get("seq_num")
            code = r.get("icd_code")
            ver = r.get("icd_version")
            lines.append(f"seq_num={seq}, icd_code={code}, icd_version={ver}。")
        return AskResponse(
            question_type="diagnosis",
            tool_called=run.tool_called,
            tool_args=run.tool_args,
            answer="\n".join(lines),
            evidence=evidence,
            limitation=LIMITATION_TEXT,
        )

    if qt == "lab":
        metric = run.tool_args.get("metric")
        if metric is None:
            return AskResponse(
                question_type="lab",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer="问题属于实验室指标类，但未识别到具体指标（乳酸/白细胞/肌酐）。请包含明确指标名称后重试。",
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        if not run.records:
            return AskResponse(
                question_type="lab",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer=_no_data_answer(),
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        label = {"lactate": "乳酸", "wbc": "白细胞", "creatinine": "肌酐"}.get(metric, str(metric))
        lines = [
            f"在入院/ICU 锚点时间后 24 小时内，{label}相关实验室记录如下（按时间倒序，仅列查询到的字段）：",
        ]
        for r in run.records[:20]:
            t = r.get("charttime")
            num = r.get("valuenum")
            u = r.get("valueuom")
            raw = r.get("value")
            lines.append(f"时间 {t}，数值 {num} {u or ''}，原始 value={raw}。")
        if len(run.records) > 20:
            lines.append(f"（另有 {len(run.records) - 20} 条未在摘要中逐条展开，见 evidence。）")
        return AskResponse(
            question_type="lab",
            tool_called=run.tool_called,
            tool_args=run.tool_args,
            answer="\n".join(lines),
            evidence=evidence,
            limitation=LIMITATION_TEXT,
        )

    if qt == "vital":
        metric = run.tool_args.get("metric")
        if metric is None:
            return AskResponse(
                question_type="vital",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer="问题属于生命体征类，但未识别到具体项目（心率/血压/体温）。请包含明确项目名称后重试。",
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        if not run.records:
            return AskResponse(
                question_type="vital",
                tool_called=run.tool_called,
                tool_args=run.tool_args,
                answer=_no_data_answer(),
                evidence=[],
                limitation=LIMITATION_TEXT,
            )
        if metric == "blood_pressure":
            lines = ["在锚点后 24 小时内，血压相关记录（收缩压/舒张压分项，仅陈述测量值）："]
        elif metric == "heart_rate":
            lines = ["在锚点后 24 小时内，心率相关记录："]
        else:
            lines = ["在锚点后 24 小时内，体温相关记录："]
        for r in run.records[:20]:
            t = r.get("charttime")
            comp = r.get("_vital_component")
            num = r.get("valuenum")
            u = r.get("valueuom")
            raw = r.get("value")
            prefix = f"[{comp}] " if comp else ""
            lines.append(f"{prefix}时间 {t}，数值 {num} {u or ''}，原始 value={raw}。")
        if len(run.records) > 20:
            lines.append(f"（另有 {len(run.records) - 20} 条未在摘要中逐条展开，见 evidence。）")
        return AskResponse(
            question_type="vital",
            tool_called=run.tool_called,
            tool_args=run.tool_args,
            answer="\n".join(lines),
            evidence=evidence,
            limitation=LIMITATION_TEXT,
        )

    return AskResponse(
        question_type="unknown",
        tool_called=run.tool_called,
        tool_args=run.tool_args,
        answer=_no_data_answer(),
        evidence=[],
        limitation=LIMITATION_TEXT,
    )
