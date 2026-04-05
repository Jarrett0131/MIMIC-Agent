"""
模板生成回答与证据（不接 LLM）；内容严格来自 route_result.data。
"""

from __future__ import annotations

from typing import Any

from app.schemas import AskResponse

LIMITATION_OK = (
    "本输出基于 MIMIC-IV Demo 与规则查询，仅供课程展示，非临床决策依据，不构成诊疗建议。"
)
LIMITATION_EMPTY = "当前患者在现有 demo 数据范围内没有匹配结果。"
LIMITATION_UNSUPPORTED = "仅支持基本信息、诊断、乳酸、肌酐、白细胞、心率、血压相关问题。"


def _json_val(v: Any) -> object:
    if v is None:
        return None
    if hasattr(v, "item") and callable(getattr(v, "item", None)):
        try:
            out = v.item()
            return _json_val(out)
        except (ValueError, TypeError, AttributeError):
            return str(v)
    if isinstance(v, (int, float, str, bool)):
        return v
    if hasattr(v, "isoformat"):
        try:
            return v.isoformat()
        except (TypeError, ValueError):
            return str(v)
    return str(v)


def _json_dict(d: dict[str, Any]) -> dict[str, object]:
    return {str(k): _json_val(v) for k, v in d.items()}


def _as_evidence(data: object, max_items: int = 5) -> list[dict[str, object]]:
    if isinstance(data, list):
        out: list[dict[str, object]] = []
        for item in data[:max_items]:
            if isinstance(item, dict):
                out.append(_json_dict(item))
        return out
    if isinstance(data, dict) and data:
        return [_json_dict(data)]
    return []


def generate_answer(
    hadm_id: int, question_type: str, route_result: dict[str, object]
) -> AskResponse:
    tool_called = str(route_result.get("tool_called", "none"))
    tool_args = route_result.get("tool_args")
    if not isinstance(tool_args, dict):
        tool_args_d: dict[str, object] = {"hadm_id": hadm_id}
    else:
        tool_args_d = {str(k): _json_val(v) for k, v in tool_args.items()}

    data = route_result.get("data")

    if question_type == "unsupported":
        return AskResponse(
            question_type=question_type,
            tool_called=tool_called,
            tool_args=tool_args_d,
            answer="当前 demo 暂不支持该类问题。",
            evidence=[],
            limitation=LIMITATION_UNSUPPORTED,
        )

    def empty_resp() -> AskResponse:
        return AskResponse(
            question_type=question_type,
            tool_called=tool_called,
            tool_args=tool_args_d,
            answer="未查询到相关记录。",
            evidence=[],
            limitation=LIMITATION_EMPTY,
        )

    if question_type == "overview":
        if not isinstance(data, dict) or not data:
            return empty_resp()
        ov = _json_dict(data)
        parts: list[str] = []
        if ov.get("gender") is not None:
            parts.append(f"性别：{ov['gender']}")
        if ov.get("age") is not None:
            parts.append(f"年龄：{ov['age']}")
        if ov.get("admittime"):
            parts.append(f"入院时间：{ov['admittime']}")
        if ov.get("dischtime"):
            parts.append(f"出院时间：{ov['dischtime']}")
        if ov.get("icu_intime"):
            parts.append(f"ICU 入科时间：{ov['icu_intime']}")
        if ov.get("icu_outtime"):
            parts.append(f"ICU 出科时间：{ov['icu_outtime']}")
        if not parts:
            return empty_resp()
        answer = "患者基本信息：" + "；".join(parts) + "。"
        return AskResponse(
            question_type=question_type,
            tool_called=tool_called,
            tool_args=tool_args_d,
            answer=answer,
            evidence=[ov],
            limitation=LIMITATION_OK,
        )

    if question_type == "diagnosis":
        if not isinstance(data, list) or len(data) == 0:
            return empty_resp()
        rows = [_json_dict(r) for r in data if isinstance(r, dict)]
        if not rows:
            return empty_resp()
        codes: list[str] = []
        for r in rows[:20]:
            c = r.get("icd_code")
            if c is not None:
                codes.append(str(c))
        if codes:
            answer = "该患者当前查询到的诊断记录包括：" + "、".join(codes[:15])
            if len(codes) > 15:
                answer += " 等"
            answer += "。"
        else:
            # TODO: 若 ICD 列名非 icd_code，codes 可能为空，仅给出条数
            answer = f"该患者当前查询到 {len(rows)} 条诊断记录，编码字段详见 evidence。"
        return AskResponse(
            question_type=question_type,
            tool_called=tool_called,
            tool_args=tool_args_d,
            answer=answer,
            evidence=rows[:5],
            limitation=LIMITATION_OK,
        )

    if question_type in (
        "lab_lactate",
        "lab_creatinine",
        "lab_white",
        "vital_heart_rate",
        "vital_blood_pressure",
    ):
        if not isinstance(data, list) or len(data) == 0:
            return empty_resp()
        rows_ev = _as_evidence(data, 5)
        r0 = data[0]
        if not isinstance(r0, dict):
            return empty_resp()
        r = _json_dict(r0)
        label = r.get("label")
        if label is None or label == "":
            label = "该项指标"
        val = r.get("valuenum")
        if val is None:
            val = r.get("value")
        uom = r.get("valueuom")
        uom_s = f" {uom}" if uom not in (None, "") else ""
        ct = r.get("charttime")
        answer = f"最近查询到的 {label} 结果为 {val}{uom_s}，记录时间为 {ct}。"
        return AskResponse(
            question_type=question_type,
            tool_called=tool_called,
            tool_args=tool_args_d,
            answer=answer,
            evidence=rows_ev,
            limitation=LIMITATION_OK,
        )

    return empty_resp()
