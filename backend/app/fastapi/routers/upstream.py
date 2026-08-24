"""Upstream system FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import UpstreamResponse, validate_contract
from ...services.upstream_service import (
    UpstreamDataSourceError,
    UpstreamSystemAlreadyExistsError,
    UpstreamSystemNotFoundError,
    UpstreamValidationError,
)
from ..dependencies import require_authenticated, require_permission
from ..errors import _service_error_response


def _upstream_error_status(error: Any) -> int:
    if isinstance(error, UpstreamSystemNotFoundError):
        return 404
    if isinstance(error, UpstreamSystemAlreadyExistsError):
        return 409
    if isinstance(error, UpstreamValidationError):
        return 422
    return 500


def _upstream_error_response(error: Any) -> JSONResponse:
    return _service_error_response(error, _upstream_error_status(error))


def _register_upstream_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/upstreams",
        tags=["upstream-migration"],
        dependencies=[Depends(require_authenticated)],
    )

    def get_service() -> Any:
        return service

    @router.get("/systems", response_model=None)
    def get_systems(
        keyword: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db_type: str | None = Query(default=None, alias="dbType"),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        limit: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_systems(
                keyword=keyword,
                status=status,
                db_type=db_type,
                page=page,
                page_size=page_size or limit,
            )
        except UpstreamDataSourceError as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract({"items": items}, UpstreamResponse)
        )

    @router.get("/systems/{system_id}", response_model=None)
    def get_system_detail(
        system_id: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_system_detail(system_id)
        except (UpstreamSystemNotFoundError, UpstreamDataSourceError) as error:
            return _upstream_error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, UpstreamResponse))

    @router.get("/systems/{system_id}/admin-detail", response_model=None)
    def get_system_admin_detail(
        system_id: str,
        _context: RequestContext = Depends(require_permission("upstream:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_system_admin_detail(system_id)
        except (UpstreamSystemNotFoundError, UpstreamDataSourceError) as error:
            return _upstream_error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, UpstreamResponse))

    @router.post("/systems", response_model=None, status_code=201)
    def create_system(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_system(payload)
        except (
            UpstreamValidationError,
            UpstreamSystemAlreadyExistsError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "上游系统创建成功", "data": data}, UpstreamResponse
            ),
        )

    @router.put("/systems/{system_id}", response_model=None)
    def update_system(
        system_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_system(system_id, payload)
        except (
            UpstreamSystemNotFoundError,
            UpstreamValidationError,
            UpstreamSystemAlreadyExistsError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "上游系统更新成功", "data": data}, UpstreamResponse
            )
        )

    @router.patch("/systems/{system_id}/status", response_model=None)
    def patch_system_status(
        system_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            data = current_service.patch_status(system_id, payload.get("status"))
        except (
            UpstreamSystemNotFoundError,
            UpstreamValidationError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "上游系统状态更新成功", "data": data}, UpstreamResponse
            )
        )

    @router.delete("/systems/{system_id}", response_model=None)
    def delete_system(
        system_id: str,
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_system(system_id)
        except (UpstreamSystemNotFoundError, UpstreamDataSourceError) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "上游系统删除成功"}, UpstreamResponse)
        )

    app.include_router(router)
