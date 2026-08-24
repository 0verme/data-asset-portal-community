"""FastAPI-native common infrastructure routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import logging
from typing import Any

from fastapi import (  # pyright: ignore[reportAttributeAccessIssue]
    APIRouter,
    Depends,
    FastAPI,
    Query,
)
from fastapi.responses import JSONResponse  # pyright: ignore[reportMissingImports]

from ...core.capabilities import capabilities_public_payload
from ...services.search_provider import SCOPE_ALL, SearchDataSourceError
from ..dependencies import require_authenticated
from ..errors import _service_error_response

LOGGER = logging.getLogger(__name__)


def _register_infrastructure_routes(
    app: FastAPI,
    capabilities: dict[str, Any],
    portal_service: Any,
    search_provider: Any,
) -> None:
    capabilities_router = APIRouter(
        prefix="/api/capabilities", tags=["capabilities-native"]
    )

    @capabilities_router.get("", response_model=None)
    def get_capabilities():
        return JSONResponse(
            content=capabilities_public_payload(capabilities)
        )

    portal_router = APIRouter(
        prefix="/api/portal",
        tags=["portal-native"],
        dependencies=[Depends(require_authenticated)],
    )

    @portal_router.get("/stats", response_model=None)
    def get_portal_stats():
        try:
            items = portal_service.get_stats()
        except Exception:
            LOGGER.exception("portal stats fatal; returning zero-filled fallback")
            items = portal_service.zero_stats()
        return JSONResponse(content={"items": items})

    search_router = APIRouter(
        prefix="/api/search",
        tags=["search-native"],
        dependencies=[Depends(require_authenticated)],
    )

    @search_router.get("", response_model=None)
    def unified_search(
        query: str = Query(default="", alias="q"),
        scope: str | None = Query(default=None),
        search_type: str | None = Query(default=None, alias="type"),
        module: str | None = Query(default=None),
        limit: str = Query(default="5"),
    ):
        effective_scope = scope or search_type or module or SCOPE_ALL
        try:
            result = search_provider.search(
                query,
                scope=effective_scope,
                limit=limit,
            )
        except SearchDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=result)

    app.include_router(capabilities_router)
    app.include_router(portal_router)
    app.include_router(search_router)
