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

from ...application import RequestContext
from ...core.capabilities import capabilities_public_payload
from ...services.search_provider import SCOPE_ALL, SearchDataSourceError
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_public_catalog_access,
)
from ..errors import _service_error_response
from ..public_catalog import profile_for_request, project_public_catalog_value
from ...settings import get_public_catalog_config

LOGGER = logging.getLogger(__name__)


def _register_infrastructure_routes(
    app: FastAPI,
    capabilities: dict[str, Any],
    portal_service: Any,
    search_provider: Any,
) -> None:
    # ``/api/capabilities`` is a compatibility endpoint for the open
    # repository-module contract. It does not perform dependency readiness,
    # menu, RBAC, profile, license, or route-registration gating.
    capabilities_router = APIRouter(
        prefix="/api/capabilities", tags=["capabilities-native"]
    )

    @capabilities_router.get("", response_model=None)
    def get_capabilities():
        return JSONResponse(
            content=capabilities_public_payload(capabilities)
        )

    public_catalog_router = APIRouter(
        prefix="/api/public-catalog",
        tags=["public-catalog-native"],
    )

    @public_catalog_router.get("/config", response_model=None)
    def get_public_catalog_configuration():
        return JSONResponse(content=get_public_catalog_config())

    portal_router = APIRouter(
        prefix="/api/portal",
        tags=["portal-native"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    @portal_router.get("/stats", response_model=None)
    def get_portal_stats(
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            items = portal_service.get_stats()
        except Exception:
            LOGGER.exception("portal stats fatal; returning zero-filled fallback")
            items = portal_service.zero_stats()
        profile = profile_for_request(context, authorization)
        return JSONResponse(
            content=project_public_catalog_value({"items": items}, profile=profile)
        )

    search_router = APIRouter(
        prefix="/api/search",
        tags=["search-native"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    @search_router.get("", response_model=None)
    def unified_search(
        query: str = Query(default="", alias="q"),
        scope: str | None = Query(default=None),
        search_type: str | None = Query(default=None, alias="type"),
        module: str | None = Query(default=None),
        limit: str = Query(default="5"),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
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
        profile = profile_for_request(context, authorization)
        return JSONResponse(content=project_public_catalog_value(result, profile=profile))

    app.include_router(public_catalog_router)
    app.include_router(capabilities_router)
    app.include_router(portal_router)
    app.include_router(search_router)
