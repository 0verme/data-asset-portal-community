"""FastAPI pilot adapter for the DB_READY Indicator module.

This app is intentionally a separate, opt-in ASGI application. Flask remains
the production entry point until P5. The adapter reuses the existing
IndicatorService and Pydantic contracts; it does not contain business logic.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .application import RequestContext
from .application.errors import ApplicationError, AuthenticationRequiredError
from .contracts import (
    AssetField,
    AssetItem,
    AssetPageResponse,
    AssetTableRequest,
    DataEnvelope,
    ErrorEnvelope,
    IndicatorItem,
    IndicatorListResponse,
    IndicatorRequest,
    ItemsResponse,
    MessageDataResponse,
    validate_contract,
)
from .core.capabilities import resolve_capabilities
from .services.assets_service import (
    AssetAlreadyExistsError,
    AssetDataSourceError,
    AssetNotFoundError,
    AssetValidationError,
    assets_service,
)
from .services.indicator_service import (
    IndicatorAlreadyExistsError,
    IndicatorDataSourceError,
    IndicatorNotFoundError,
    IndicatorValidationError,
    indicator_service,
)


LOGGER = logging.getLogger(__name__)
IdentityResolver = Callable[[Request], Any]

_HTTP_ERROR_COPY = {
    404: "请求的资源不存在",
    405: "请求方法不被允许",
    413: "请求体过大",
    415: "不支持的媒体类型",
}


def _error_payload(error: Any) -> dict[str, Any]:
    if hasattr(error, "to_dict"):
        return {"error": error.to_dict()}
    return {"error": {"code": "INTERNAL_SERVER_ERROR", "message": "服务端发生未预期异常"}}


def _service_error_response(error: Any, status: int) -> JSONResponse:
    payload = validate_contract(_error_payload(error), ErrorEnvelope)
    return JSONResponse(status_code=status, content=payload)


async def get_request_context(request: Request) -> RequestContext:
    """Resolve an identity at the adapter boundary and build core context."""
    resolver: IdentityResolver = request.app.state.identity_resolver
    identity = resolver(request)
    if inspect.isawaitable(identity):
        identity = await identity
    client_address = request.client.host if request.client else None
    return RequestContext(
        identity=identity,
        request_id=request.headers.get("X-Request-ID"),
        client_address=client_address,
    )


def require_maintainer(
    context: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """FastAPI auth adapter retaining the current maintainer gate."""
    if context.identity is None:
        raise AuthenticationRequiredError("请先登录。")
    return context


def _indicator_payload(payload: IndicatorRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_indicator_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/indicators", tags=["indicator-pilot"])

    def get_service() -> Any:
        return service

    @router.get("", response_model=None)
    def get_indicators(
        keyword: str | None = Query(default=None),
        dimension: str | None = Query(default=None),
        status: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_indicators(
                keyword=keyword,
                dimension=dimension,
                status=status,
            )
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, IndicatorListResponse)
        )

    @router.get("/{indicator_id}", response_model=None)
    def get_indicator_detail(
        indicator_id: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_indicator_detail(indicator_id)
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[IndicatorItem])
        )

    @router.post("", response_model=None, status_code=201)
    def create_indicator(
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_indicator(_indicator_payload(payload))
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "指标创建成功", "data": data},
                MessageDataResponse[IndicatorItem],
            ),
        )

    @router.put("/{indicator_id}", response_model=None)
    def update_indicator(
        indicator_id: str,
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_indicator(
                indicator_id,
                _indicator_payload(payload),
            )
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "指标更新成功", "data": data},
                MessageDataResponse[IndicatorItem],
            )
        )

    @router.patch("/{indicator_id}/status", response_model=None)
    def patch_indicator_status(
        indicator_id: str,
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        body = _indicator_payload(payload) or {}
        try:
            data = current_service.patch_status(indicator_id, body.get("status"))
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "指标状态更新成功", "data": data},
                MessageDataResponse[IndicatorItem],
            )
        )

    @router.delete("/{indicator_id}", response_model=None)
    def delete_indicator(
        indicator_id: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_indicator(indicator_id)
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content={"message": "指标删除成功"})

    app.include_router(router)


def _asset_payload(payload: AssetTableRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_asset_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/assets", tags=["assets-migration"])

    def get_service() -> Any:
        return service

    @router.get("/tables", response_model=None)
    def get_asset_tables(
        layer: str | None = Query(default=None),
        domain: str | None = Query(default=None),
        keyword: str | None = Query(default=None),
        schema: str | None = Query(default=None),
        owner: str | None = Query(default=None),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        order_by: str | None = Query(default=None, alias="orderBy"),
        summary: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            if str(summary or "").strip().lower() in {"1", "true", "yes"}:
                payload = current_service.get_asset_table_page(
                    layer=layer,
                    domain=domain,
                    keyword=keyword,
                    schema=schema,
                    owner=owner,
                    page=page,
                    page_size=page_size,
                    order_by=order_by,
                )
            else:
                payload = {
                    "items": current_service.get_asset_tables(
                        layer=layer,
                        domain=domain,
                        keyword=keyword,
                        schema=schema,
                        owner=owner,
                        page=page,
                        page_size=page_size,
                        order_by=order_by,
                    )
                }
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        response_model = AssetPageResponse if "page" in payload else ItemsResponse[AssetItem]
        return JSONResponse(content=validate_contract(payload, response_model))

    @router.get("/tables/{table_name}", response_model=None)
    def get_asset_detail(
        table_name: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_asset_detail(table_name)
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[AssetItem]))

    @router.get("/tables/{table_name}/fields", response_model=None)
    def get_asset_fields(
        table_name: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_asset_fields(table_name)
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, ItemsResponse[AssetField]))

    @router.get("/tables/{table_name}/ddl", response_model=None)
    def get_asset_ddl(
        table_name: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_asset_ddl(table_name)
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[object]))

    @router.get("/domains", response_model=None)
    def get_domains(
        layer: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_domains(layer=layer)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, ItemsResponse[object]))

    @router.get("/layers", response_model=None)
    def get_layers(
        domain: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_layers(domain=domain)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, ItemsResponse[object]))

    @router.post("/tables", response_model=None, status_code=201)
    def create_asset_table(
        payload: AssetTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_asset_table(_asset_payload(payload))
        except AssetValidationError as error:
            return _service_error_response(error, 422)
        except AssetAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "数据表创建成功", "data": data},
                MessageDataResponse[AssetItem],
            ),
        )

    @router.put("/tables/{table_name}", response_model=None)
    def update_asset_table(
        table_name: str,
        payload: AssetTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_asset_table(table_name, _asset_payload(payload))
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetValidationError as error:
            return _service_error_response(error, 422)
        except AssetAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "数据表更新成功", "data": data},
                MessageDataResponse[AssetItem],
            )
        )

    @router.put("/tables/{table_name}/fields", response_model=None)
    def update_asset_fields(
        table_name: str,
        payload: AssetTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_asset_fields(table_name, _asset_payload(payload))
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetValidationError as error:
            return _service_error_response(error, 422)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "字段列表更新成功", "data": data},
                MessageDataResponse[object],
            )
        )

    @router.delete("/tables/{table_name}", response_model=None)
    def delete_asset_table(
        table_name: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_asset_table(table_name)
        except AssetNotFoundError as error:
            return _service_error_response(error, 404)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content={"message": "数据表删除成功"})

    app.include_router(router)


def create_fastapi_app(
    *,
    capabilities: dict[str, Any] | None = None,
    identity_resolver: IdentityResolver | None = None,
    indicator_service_instance: Any | None = None,
    assets_service_instance: Any | None = None,
) -> FastAPI:
    """Create the opt-in FastAPI pilot application.

    ``identity_resolver`` is the explicit auth adapter seam. Production
    deployment must provide the resolver that bridges its session/token
    runtime; tests can inject an identity without Flask request context.
    """
    app = FastAPI(title="Data Asset Portal FastAPI Pilot", version="0.1.0")
    app.state.identity_resolver = identity_resolver or (lambda _request: None)
    indicator = indicator_service_instance or indicator_service
    assets = assets_service_instance or assets_service

    @app.exception_handler(ApplicationError)
    async def handle_application_error(_request: Request, error: ApplicationError):
        return JSONResponse(
            status_code=error.status_code,
            content=validate_contract({"error": error.to_dict()}, ErrorEnvelope),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request, error: RequestValidationError
    ):
        details = [
            {"field": "body", "message": str(item.get("msg") or "请求参数不合法")}
            for item in error.errors()
        ]
        payload = {"error": {"code": "VALIDATION_ERROR", "message": "请求参数不合法", "details": details}}
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, error: StarletteHTTPException):
        code = int(error.status_code)
        payload = {
            "error": {
                "code": "NOT_FOUND" if code == 404 else f"HTTP_{code}",
                "message": _HTTP_ERROR_COPY.get(code, "请求失败"),
            }
        }
        return JSONResponse(status_code=code, content=payload)

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, error: Exception):
        LOGGER.exception("FastAPI pilot request failed", exc_info=error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_SERVER_ERROR",
                    "message": "服务端发生未预期异常",
                }
            },
        )

    effective_capabilities = capabilities
    if effective_capabilities is None:
        effective_capabilities = resolve_capabilities()
    enabled_codes = set(effective_capabilities.get("enabled_codes") or [])
    if "indicator" in enabled_codes:
        _register_indicator_routes(app, indicator)
    if "dwm" in enabled_codes:
        _register_asset_routes(app, assets)
    return app
