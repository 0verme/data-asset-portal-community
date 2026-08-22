"""API asset FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    ApiAssetItem,
    ApiAssetListResponse,
    ApiAssetRequest,
    DataEnvelope,
    MessageDataResponse,
    validate_contract,
)
from ...services.api_asset_service import ApiAssetError
from ..dependencies import require_permission
from ..errors import _service_error_response


def _register_api_asset_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/api-assets", tags=["api-asset-migration"])

    def get_service() -> Any:
        return service

    def error_response(error: ApiAssetError) -> JSONResponse:
        return _service_error_response(error, error.status)

    def request_payload(payload: ApiAssetRequest | None) -> dict[str, Any] | None:
        return None if payload is None else payload.model_dump(exclude_unset=True)

    def items_payload(payload: dict[str, Any] | None) -> list[Any] | None:
        return payload.get("items") if isinstance(payload, dict) else None

    @router.get("", response_model=None)
    def list_assets(
        keyword: str | None = Query(default=None),
        status: str | None = Query(default=None),
        method: str | None = Query(default=None),
        downstream_system_id: str | None = Query(
            default=None, alias="downstreamSystemId"
        ),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {
                "items": current_service.get_assets(
                    keyword, status, method, downstream_system_id
                )
            }
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract(data, ApiAssetListResponse))

    @router.get("/downstream-systems", response_model=None)
    def downstream_systems(
        keyword: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {"items": current_service.get_downstream_systems(keyword)}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=data)

    @router.get("/systems", response_model=None)
    def systems(
        keyword: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        return downstream_systems(keyword, current_service)

    @router.get("/{api_code}", response_model=None)
    def detail(api_code: str, current_service: Any = Depends(get_service)):
        try:
            data = {"data": current_service.get_asset(api_code)}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract(data, DataEnvelope[ApiAssetItem]))

    @router.post("", response_model=None, status_code=201)
    def create(
        payload: ApiAssetRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("api_asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {
                "message": "API asset created",
                "data": current_service.create(request_payload(payload)),
            }
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(data, MessageDataResponse[ApiAssetItem]),
        )

    @router.put("/{api_code}", response_model=None)
    def update(
        api_code: str,
        payload: ApiAssetRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("api_asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {
                "message": "API asset updated",
                "data": current_service.update(api_code, request_payload(payload)),
            }
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract(data, MessageDataResponse[ApiAssetItem])
        )

    @router.patch("/{api_code}/status", response_model=None)
    def status(
        api_code: str,
        payload: ApiAssetRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("api_asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {
                "message": "API asset status updated",
                "data": current_service.update_status(
                    api_code, request_payload(payload)
                ),
            }
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract(data, MessageDataResponse[ApiAssetItem])
        )

    @router.delete("/{api_code}", response_model=None)
    def delete(
        api_code: str,
        _context: RequestContext = Depends(require_permission("api_asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete(api_code)
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content={"message": "API asset deleted"})

    for suffix, kind, message in (
        ("params", "params", "API params updated"),
        ("response-fields", "responseFields", "API response fields updated"),
        ("relations", "relations", "API relations updated"),
    ):

        @router.put(f"/{{api_code}}/{suffix}", response_model=None)
        def replace_rows(
            api_code: str,
            payload: dict[str, Any] | None = Body(default=None),
            _context: RequestContext = Depends(require_permission("api_asset:write")),
            current_service: Any = Depends(get_service),
            kind=kind,
            message=message,
        ):
            try:
                data = {
                    "message": message,
                    "data": current_service.replace_rows(
                        api_code, items_payload(payload), kind
                    ),
                }
            except ApiAssetError as error:
                return error_response(error)
            return JSONResponse(
                content=validate_contract(data, MessageDataResponse[ApiAssetItem])
            )

    app.include_router(router)
