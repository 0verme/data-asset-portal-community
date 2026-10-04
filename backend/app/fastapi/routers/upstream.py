"""Upstream system FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    UpstreamDataResponse,
    UpstreamListResponse,
    UpstreamMessageResponse,
    UpstreamResponse,
    UpstreamSystemRequest,
    validate_contract,
)
from ...services.upstream_service import (
    UpstreamDataSourceError,
    UpstreamSystemAlreadyExistsError,
    UpstreamSystemNotFoundError,
    UpstreamSystemReferencedError,
    UpstreamValidationError,
)
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_permission,
    require_public_catalog_access,
)
from ..public_catalog import profile_for_request, redact_public_upstream_system
from ..errors import _service_error_response


def _upstream_error_status(error: Any) -> int:
    if isinstance(error, UpstreamSystemNotFoundError):
        return 404
    if isinstance(error, (UpstreamSystemAlreadyExistsError, UpstreamSystemReferencedError)):
        return 409
    if isinstance(error, UpstreamValidationError):
        return 422
    return 500


def _upstream_error_response(error: Any) -> JSONResponse:
    return _service_error_response(error, _upstream_error_status(error))


def _upstream_payload(payload: UpstreamSystemRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_upstream_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/upstreams",
        tags=["upstream-migration"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    def get_service() -> Any:
        return service

    def project_for_request(value: Any, profile: Any) -> Any:
        return redact_public_upstream_system(value, profile=profile)

    @router.get("/systems", response_model=None)
    def get_systems(
        keyword: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db_type: str | None = Query(default=None, alias="dbType"),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        limit: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            profile = profile_for_request(context, authorization)
            items = current_service.get_systems(
                keyword=keyword,
                status=status,
                db_type=db_type,
                page=page,
                page_size=page_size or limit,
                profile=profile,
            )
        except UpstreamDataSourceError as error:
            return _upstream_error_response(error)
        items = project_for_request(items, profile)
        return JSONResponse(
            content=validate_contract({"items": items}, UpstreamListResponse)
        )

    @router.get("/systems/{system_id}", response_model=None)
    def get_system_detail(
        system_id: str,
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            profile = profile_for_request(context, authorization)
            data = current_service.get_system_detail(system_id, profile=profile)
        except (UpstreamSystemNotFoundError, UpstreamDataSourceError) as error:
            return _upstream_error_response(error)
        data = project_for_request(data, profile)
        return JSONResponse(
            content=validate_contract({"data": data}, UpstreamDataResponse)
        )

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
        return JSONResponse(
            content=validate_contract({"data": data}, UpstreamDataResponse)
        )

    @router.post("/systems", response_model=None, status_code=201)
    def create_system(
        payload: UpstreamSystemRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_system(_upstream_payload(payload))
        except (
            UpstreamValidationError,
            UpstreamSystemAlreadyExistsError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "上游系统创建成功", "data": data},
                UpstreamMessageResponse,
            ),
        )

    @router.put("/systems/{system_id}", response_model=None)
    def update_system(
        system_id: str,
        payload: UpstreamSystemRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_system(
                system_id, _upstream_payload(payload)
            )
        except (
            UpstreamSystemNotFoundError,
            UpstreamValidationError,
            UpstreamSystemAlreadyExistsError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "上游系统更新成功", "data": data},
                UpstreamMessageResponse,
            )
        )

    @router.patch("/systems/{system_id}/status", response_model=None)
    def patch_system_status(
        system_id: str,
        payload: UpstreamSystemRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("upstream:write")),
        current_service: Any = Depends(get_service),
    ):
        body = _upstream_payload(payload) or {}
        try:
            data = current_service.patch_status(system_id, body.get("status"))
        except (
            UpstreamSystemNotFoundError,
            UpstreamValidationError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "上游系统状态更新成功", "data": data},
                UpstreamMessageResponse,
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
        except (
            UpstreamSystemNotFoundError,
            UpstreamSystemReferencedError,
            UpstreamDataSourceError,
        ) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "上游系统删除成功"}, UpstreamResponse)
        )

    app.include_router(router)
