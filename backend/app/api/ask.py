"""
问答 HTTP 接口：规则路由 + 模板生成，统一响应结构。
"""

from __future__ import annotations

from fastapi import APIRouter

from app.agent.generator import generate_ask_response
from app.agent.router import route_question
from app.schemas import AskRequest, AskResponse

router = APIRouter(tags=["ask"])


@router.post("/ask", response_model=AskResponse)
def ask_clinical_question(body: AskRequest) -> AskResponse:
    """
    接收自然语言问题，经分类与数据查询后返回 answer 与 evidence。
    即使无数据也返回 200，由 answer 字段说明「未查询到相关记录」。
    """
    run = route_question(body.hadm_id, body.question)
    return generate_ask_response(run)
