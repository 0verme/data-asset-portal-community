"""Lineage FastAPI adapter routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...contracts import LineageResponse, validate_contract
from ...services.lineage import (
    LineageValidationError,
    get_bootstrap as get_lineage_bootstrap,
    get_initial_view as get_lineage_initial_view,
    get_subgraph as get_lineage_subgraph,
    search_nodes as search_lineage_nodes,
)
from ..dependencies import require_authenticated
from ..errors import _service_error_response


class _LineageServiceAdapter:
    """Expose the existing reader functions through the adapter seam."""

    @staticmethod
    def get_bootstrap():
        return get_lineage_bootstrap()

    @staticmethod
    def search_nodes(name):
        return search_lineage_nodes(name)

    @staticmethod
    def get_subgraph(root_id, direction, depth, max_nodes, view):
        return get_lineage_subgraph(root_id, direction, depth, max_nodes, view)

    @staticmethod
    def get_initial_view(root_id, direction, depth, max_nodes, view):
        return get_lineage_initial_view(root_id, direction, depth, max_nodes, view)


lineage_service = _LineageServiceAdapter()

def _register_lineage_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/lineage",
        tags=["lineage-migration"],
        dependencies=[Depends(require_authenticated)],
    )

    def get_service() -> Any:
        return service

    def error_response(error: LineageValidationError) -> JSONResponse:
        return _service_error_response(error, getattr(error, "status_code", 422))

    @router.get("/bootstrap", response_model=None)
    def get_bootstrap(current_service: Any = Depends(get_service)):
        try:
            data = current_service.get_bootstrap()
        except LineageValidationError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, LineageResponse))

    @router.get("/assets", response_model=None)
    def get_assets(
        name: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.search_nodes(name)
        except LineageValidationError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, LineageResponse))

    @router.get("/subgraph", response_model=None)
    def get_subgraph(
        root_id: str | None = Query(default=None, alias="rootId"),
        direction: str | None = Query(default="both"),
        depth: str | None = Query(default=None),
        max_nodes: str | None = Query(default=None, alias="maxNodes"),
        view: str | None = Query(default="table"),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_subgraph(
                root_id, direction, depth, max_nodes, view
            )
        except LineageValidationError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, LineageResponse))

    @router.get("/initial-view", response_model=None)
    def get_initial_view(
        root_id: str | None = Query(default=None, alias="rootId"),
        direction: str | None = Query(default="both"),
        depth: str | None = Query(default=None),
        max_nodes: str | None = Query(default=None, alias="maxNodes"),
        view: str | None = Query(default="table"),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_initial_view(
                root_id, direction, depth, max_nodes, view
            )
        except LineageValidationError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, LineageResponse))

    app.include_router(router)
