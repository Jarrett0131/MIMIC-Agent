"""
POST /ask
"""

from __future__ import annotations

from fastapi import APIRouter

from app.agent.classifier import classify_question
from app.agent.generator import generate_answer
from app.agent.router import route_question
from app.schemas import AskRequest, AskResponse

router = APIRouter(tags=["ask"])


@router.post("/ask", response_model=AskResponse)
def ask(body: AskRequest) -> AskResponse:
    qtype = classify_question(body.question)
    route = route_question(body.hadm_id, qtype)
    return generate_answer(body.hadm_id, qtype, route)
