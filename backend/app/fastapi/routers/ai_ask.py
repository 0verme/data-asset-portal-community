"""Optional single-turn AI metadata Q&A endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, FastAPI

from ...application import RequestContext
from ...contracts.ai_ask import AiAskAvailability, AiAskRequest, AiAskResponse
from ...services.ai_ask_service import AIAskService
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_public_catalog_access,
)
from ..public_catalog import profile_for_request

LOGGER = logging.getLogger(__name__)


def _register_ai_ask_routes(
    app: FastAPI,
    ai_ask_service: AIAskService | Any,
) -> None:
    router = APIRouter(
        prefix="/api/ai",
        tags=["ai-ask-native"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    @router.get("/status", response_model=AiAskAvailability)
    def get_ai_ask_status():
        try:
            enabled = bool(ai_ask_service.enabled())
        except Exception:
            # Configuration errors fail closed and never disclose deployment data.
            enabled = False
        return AiAskAvailability(enabled=enabled)

    @router.post("/ask", response_model=AiAskResponse)
    def ask_ai(
        payload: AiAskRequest,
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        profile = profile_for_request(context, authorization)
        try:
            return ai_ask_service.ask(payload, profile=profile)
        except Exception:
            LOGGER.warning("AI ask failed without exposing provider details")
            return AiAskResponse(
                status="generation_unavailable",
                answer="AI 问答暂不可用，请稍后重试。",
                candidates=[],
                citations=[],
                retrievalStatus="not_run",
                generationStatus="unavailable",
                reasonCode="llm_unavailable",
                elapsedMs=0,
            )

    app.include_router(router)
