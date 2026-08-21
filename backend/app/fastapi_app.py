"""FastAPI pilot adapter for the DB_READY Indicator module.

This app is intentionally a separate, opt-in ASGI application. Flask remains
the production entry point until P5. The adapter reuses the existing
IndicatorService and Pydantic contracts; it does not contain business logic.
"""

from __future__ import annotations

import csv
import inspect
import io
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .application import RequestContext
from .application.errors import (
    ApplicationError,
    AuthenticationRequiredError,
    PermissionDeniedError,
)
from .contracts import (
    AssetField,
    AssetItem,
    AssetPageResponse,
    AssetTableRequest,
    ApiAssetItem,
    ApiAssetListResponse,
    ApiAssetRequest,
    DataEnvelope,
    ErrorEnvelope,
    FieldMappingListResponse,
    FieldMappingTableListResponse,
    ManualCodeTableItem,
    ManualCodeTableListResponse,
    ManualCodeTableRequest,
    MappingStats,
    RootCategoryListResponse,
    RootItem,
    RootListResponse,
    RootRequest,
    ReportItem,
    ReportListResponse,
    ReportRequest,
    SourceSystemListResponse,
    IndicatorItem,
    IndicatorListResponse,
    IndicatorRequest,
    ItemsResponse,
    LineageResponse,
    MessageDataResponse,
    SystemResponse,
    UpstreamResponse,
    validate_contract,
)
from .core.capabilities import resolve_capabilities
from .services.api_asset_service import ApiAssetError, api_asset_service
from .services.field_mapping_service import (
    FieldMappingDataSourceError,
    field_mapping_service,
)
from .services.manual_code_table_service import (
    ManualCodeTableAlreadyExistsError,
    ManualCodeTableDataSourceError,
    ManualCodeTableNotFoundError,
    ManualCodeTableValidationError,
    manual_code_table_service,
)
from .services.root_service import (
    RootAlreadyExistsError,
    RootDataSourceError,
    RootNotFoundError,
    RootValidationError,
    root_service,
)
from .services.report_service import (
    ReportAlreadyExistsError,
    ReportDataSourceError,
    ReportNotFoundError,
    ReportValidationError,
    report_service,
)
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
from .services.lineage import (
    LineageValidationError,
    get_bootstrap as get_lineage_bootstrap,
    get_initial_view as get_lineage_initial_view,
    get_subgraph as get_lineage_subgraph,
    search_nodes as search_lineage_nodes,
)
from .services.operation_log_service import (
    OperationLogDataSourceError,
    OperationLogNotFoundError,
    OperationLogValidationError,
    operation_log_service,
)
from .services.system_management_service import (
    MenuAlreadyExistsError,
    MenuNotFoundError,
    ParamCategoryNotFoundError,
    ParamDictAlreadyExistsError,
    ParamDictNotFoundError,
    SystemDataSourceError,
    SystemManagementError,
    SystemUserAlreadyExistsError,
    SystemUserNotFoundError,
    SystemValidationError,
    system_management_service,
)
from .services.upstream_service import (
    UpstreamDataSourceError,
    UpstreamSystemAlreadyExistsError,
    UpstreamSystemNotFoundError,
    UpstreamValidationError,
    upstream_service,
)


LOGGER = logging.getLogger(__name__)
IdentityResolver = Callable[[Request], Any]

_HTTP_ERROR_COPY = {
    404: "请求的资源不存在",
    405: "请求方法不被允许",
    413: "请求体过大",
    415: "不支持的媒体类型",
}


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


def require_admin(
    context: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """FastAPI auth adapter retaining the current administrator gate."""
    if context.identity is None:
        raise AuthenticationRequiredError("请先登录管理员账号。")
    if not context.identity.is_admin:
        raise PermissionDeniedError("仅系统管理员可执行此操作。")
    return context


def _system_error_status(error: SystemManagementError) -> int:
    if isinstance(error, (MenuNotFoundError, ParamCategoryNotFoundError, ParamDictNotFoundError, SystemUserNotFoundError)):
        return 404
    if isinstance(error, (MenuAlreadyExistsError, ParamDictAlreadyExistsError, SystemUserAlreadyExistsError)):
        return 409
    if isinstance(error, SystemValidationError):
        return 422
    if isinstance(error, SystemDataSourceError):
        return 500
    return 500


def _system_error_response(error: SystemManagementError) -> JSONResponse:
    return _service_error_response(error, _system_error_status(error))


def _operation_log_error_response(error: Any) -> JSONResponse:
    if isinstance(error, OperationLogValidationError):
        status = 422
    elif isinstance(error, OperationLogNotFoundError):
        status = 404
    else:
        status = 500
    return _service_error_response(error, status)


def _system_payload(payload: Any) -> Any:
    return payload


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
        downstream_system_id: str | None = Query(default=None, alias="downstreamSystemId"),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {"items": current_service.get_assets(keyword, status, method, downstream_system_id)}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract(data, ApiAssetListResponse))

    @router.get("/downstream-systems", response_model=None)
    def downstream_systems(keyword: str | None = Query(default=None), current_service: Any = Depends(get_service)):
        try:
            data = {"items": current_service.get_downstream_systems(keyword)}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=data)

    @router.get("/systems", response_model=None)
    def systems(keyword: str | None = Query(default=None), current_service: Any = Depends(get_service)):
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
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = {"message": "API asset created", "data": current_service.create(request_payload(payload))}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(status_code=201, content=validate_contract(data, MessageDataResponse[ApiAssetItem]))

    @router.put("/{api_code}", response_model=None)
    def update(api_code: str, payload: ApiAssetRequest | None = Body(default=None), _context: RequestContext = Depends(require_maintainer), current_service: Any = Depends(get_service)):
        try:
            data = {"message": "API asset updated", "data": current_service.update(api_code, request_payload(payload))}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract(data, MessageDataResponse[ApiAssetItem]))

    @router.patch("/{api_code}/status", response_model=None)
    def status(api_code: str, payload: ApiAssetRequest | None = Body(default=None), _context: RequestContext = Depends(require_maintainer), current_service: Any = Depends(get_service)):
        try:
            data = {"message": "API asset status updated", "data": current_service.update_status(api_code, request_payload(payload))}
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content=validate_contract(data, MessageDataResponse[ApiAssetItem]))

    @router.delete("/{api_code}", response_model=None)
    def delete(api_code: str, _context: RequestContext = Depends(require_maintainer), current_service: Any = Depends(get_service)):
        try:
            current_service.delete(api_code)
        except ApiAssetError as error:
            return error_response(error)
        return JSONResponse(content={"message": "API asset deleted"})

    for suffix, kind, message in (("params", "params", "API params updated"), ("response-fields", "responseFields", "API response fields updated"), ("relations", "relations", "API relations updated")):
        @router.put(f"/{{api_code}}/{suffix}", response_model=None)
        def replace_rows(api_code: str, payload: dict[str, Any] | None = Body(default=None), _context: RequestContext = Depends(require_maintainer), current_service: Any = Depends(get_service), kind=kind, message=message):
            try:
                data = {"message": message, "data": current_service.replace_rows(api_code, items_payload(payload), kind)}
            except ApiAssetError as error:
                return error_response(error)
            return JSONResponse(content=validate_contract(data, MessageDataResponse[ApiAssetItem]))

    app.include_router(router)


def _register_report_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/reports", tags=["report-migration"])

    def get_service() -> Any:
        return service

    def report_payload(payload: ReportRequest | None) -> dict[str, Any] | None:
        if payload is None:
            return None
        return payload.model_dump(exclude_unset=True)

    def error_response(error: Any, status: int) -> JSONResponse:
        return _service_error_response(error, status)

    @router.get("", response_model=None)
    def get_reports(
        keyword: str | None = Query(default=None),
        report_type: str | None = Query(default=None, alias="type"),
        domain: str | None = Query(default=None),
        status: str | None = Query(default=None),
        owner_dept: str | None = Query(default=None, alias="ownerDept"),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_reports(
                keyword=keyword,
                report_type=report_type,
                domain=domain,
                status=status,
                owner_dept=owner_dept,
            )
        except ReportDataSourceError as error:
            return error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, ReportListResponse))

    @router.get("/{report_code}", response_model=None)
    def get_report_detail(report_code: str, current_service: Any = Depends(get_service)):
        try:
            data = current_service.get_report_detail(report_code)
        except ReportNotFoundError as error:
            return error_response(error, 404)
        except ReportDataSourceError as error:
            return error_response(error, 500)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[ReportItem]))

    @router.post("", response_model=None, status_code=201)
    def create_report(
        payload: ReportRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_report(report_payload(payload))
        except ReportValidationError as error:
            return error_response(error, 422)
        except ReportAlreadyExistsError as error:
            return error_response(error, 409)
        except ReportDataSourceError as error:
            return error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "报表创建成功", "data": data},
                MessageDataResponse[ReportItem],
            ),
        )

    @router.put("/{report_code}", response_model=None)
    def update_report(
        report_code: str,
        payload: ReportRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_report(report_code, report_payload(payload))
        except ReportNotFoundError as error:
            return error_response(error, 404)
        except ReportValidationError as error:
            return error_response(error, 422)
        except ReportAlreadyExistsError as error:
            return error_response(error, 409)
        except ReportDataSourceError as error:
            return error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "报表更新成功", "data": data},
                MessageDataResponse[ReportItem],
            )
        )

    @router.delete("/{report_code}", response_model=None)
    def delete_report(
        report_code: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_report(report_code)
        except ReportNotFoundError as error:
            return error_response(error, 404)
        except ReportDataSourceError as error:
            return error_response(error, 500)
        return JSONResponse(content={"message": "报表删除成功"})

    app.include_router(router)


def _register_manual_code_table_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/manual-code-tables", tags=["manual-code-table-migration"])
    style_labels = {"enum": "标准枚举", "dim": "维度字典", "status": "状态流转", "map": "业务映射", "custom": "自定义结构"}
    status_labels = {"active": "启用", "draft": "草稿", "disabled": "停用"}

    def get_service() -> Any:
        return service

    def manual_payload(payload: ManualCodeTableRequest | None) -> dict[str, Any] | None:
        if payload is None:
            return None
        return payload.model_dump(exclude_unset=True)

    def error_response(error: Any) -> JSONResponse:
        if isinstance(error, ManualCodeTableNotFoundError):
            status = 404
        elif isinstance(error, ManualCodeTableAlreadyExistsError):
            status = 409
        elif isinstance(error, ManualCodeTableValidationError):
            status = 422
        else:
            status = 500
        return _service_error_response(error, status)

    @router.get("", response_model=None)
    def list_manual_code_tables(
        keyword: str | None = Query(default=None),
        style: str | None = Query(default=None),
        status: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_tables(keyword=keyword, style=style, status=status)
        except (ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"items": items}, ManualCodeTableListResponse))

    @router.get("/export", response_model=None)
    def export_manual_code_tables(
        keyword: str | None = Query(default=None),
        style: str | None = Query(default=None),
        status: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_tables(keyword=keyword, style=style, status=status)
        except (ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["表编码", "表名称", "表样式", "负责人", "状态", "说明", "更新时间"])
        for item in items:
            writer.writerow([
                item["tableCode"],
                item["tableName"],
                style_labels.get(item["style"], item["style"]),
                item["owner"],
                status_labels.get(item["status"], item["status"]),
                item["remark"],
                item["updatedAt"],
            ])
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=manual-code-tables.csv"},
        )

    @router.get("/{table_id}", response_model=None)
    def get_manual_code_table(table_id: str, current_service: Any = Depends(get_service)):
        try:
            data = current_service.get_table(table_id)
        except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[ManualCodeTableItem]))

    @router.post("", response_model=None, status_code=201)
    def create_manual_code_table(
        payload: ManualCodeTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_table(manual_payload(payload))
        except (ManualCodeTableAlreadyExistsError, ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "Manual code table created", "data": data},
                MessageDataResponse[ManualCodeTableItem],
            ),
        )

    @router.put("/{table_id}", response_model=None)
    def update_manual_code_table(
        table_id: str,
        payload: ManualCodeTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_table(table_id, manual_payload(payload))
        except (ManualCodeTableNotFoundError, ManualCodeTableAlreadyExistsError, ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Manual code table updated", "data": data},
                MessageDataResponse[ManualCodeTableItem],
            )
        )

    @router.patch("/{table_id}/status", response_model=None)
    def patch_manual_code_table_status(
        table_id: str,
        payload: ManualCodeTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        body = manual_payload(payload) or {}
        try:
            data = current_service.update_status(table_id, body.get("status"))
        except (ManualCodeTableNotFoundError, ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Manual code table status updated", "data": data},
                MessageDataResponse[ManualCodeTableItem],
            )
        )

    @router.delete("/{table_id}", response_model=None, status_code=204)
    def delete_manual_code_table(
        table_id: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_table(table_id)
        except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return Response(status_code=204)

    app.include_router(router)


def _register_root_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/roots", tags=["root-migration"])

    def get_service() -> Any:
        return service

    def root_payload(payload: RootRequest | None) -> dict[str, Any] | None:
        if payload is None:
            return None
        return payload.model_dump(exclude_unset=True)

    @router.get("", response_model=None)
    def get_roots(
        keyword: str | None = Query(default=None),
        cat: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_roots(keyword=keyword, cat=cat)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, RootListResponse))

    @router.get("/categories", response_model=None)
    def get_root_categories(current_service: Any = Depends(get_service)):
        try:
            items = current_service.get_root_categories()
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, RootCategoryListResponse))

    @router.get("/{abbr}", response_model=None)
    def get_root_detail(abbr: str, current_service: Any = Depends(get_service)):
        try:
            data = current_service.get_root_detail(abbr)
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[RootItem]))

    @router.post("", response_model=None, status_code=201)
    def create_root(
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_root(root_payload(payload))
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "词根创建成功", "data": data},
                MessageDataResponse[RootItem],
            ),
        )

    @router.put("/{abbr}", response_model=None)
    def update_root(
        abbr: str,
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_root(abbr, root_payload(payload))
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "词根更新成功", "data": data},
                MessageDataResponse[RootItem],
            )
        )

    @router.delete("/{abbr}", response_model=None)
    def delete_root(
        abbr: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_root(abbr)
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content={"message": "词根删除成功"})

    @router.post("/import", response_model=None)
    def import_root_items(
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.import_roots(root_payload(payload))
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "词根导入成功", "data": data},
                MessageDataResponse[object],
            )
        )

    app.include_router(router)


def _register_field_mapping_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/field-mappings", tags=["field-mapping-migration"])

    def get_service() -> Any:
        return service

    def build_params(
        keyword: str | None,
        data_source_id: str | None,
        upstream_system_id: str | None,
        source_system_id: str | None,
        src_system: str | None,
        src_table: str | None,
        src_field: str | None,
        empty_comment: str | None,
        target_table: str | None,
        target_field: str | None,
        page: str | None,
        page_size: str | None,
        sort_key: str | None,
        sort_direction: str | None,
    ) -> dict[str, str | None]:
        return {
            "keyword": keyword,
            "upstreamSystemId": data_source_id or upstream_system_id or source_system_id,
            "srcSystem": src_system,
            "srcTable": src_table,
            "srcField": src_field,
            "emptyComment": empty_comment,
            "targetTable": target_table,
            "targetField": target_field,
            "page": page,
            "pageSize": page_size,
            "sortKey": sort_key,
            "sortDirection": sort_direction,
        }

    def mapping_query_parameters(
        keyword: str | None = Query(default=None),
        data_source_id: str | None = Query(default=None, alias="dataSourceId"),
        upstream_system_id: str | None = Query(default=None, alias="upstreamSystemId"),
        source_system_id: str | None = Query(default=None, alias="sourceSystemId"),
        src_system: str | None = Query(default=None, alias="srcSystem"),
        src_table: str | None = Query(default=None, alias="srcTable"),
        src_field: str | None = Query(default=None, alias="srcField"),
        empty_comment: str | None = Query(default=None, alias="emptyComment"),
        target_table: str | None = Query(default=None, alias="targetTable"),
        target_field: str | None = Query(default=None, alias="targetField"),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        sort_key: str | None = Query(default=None, alias="sortKey"),
        sort_direction: str | None = Query(default=None, alias="sortDirection"),
    ) -> dict[str, str | None]:
        return build_params(
            keyword,
            data_source_id,
            upstream_system_id,
            source_system_id,
            src_system,
            src_table,
            src_field,
            empty_comment,
            target_table,
            target_field,
            page,
            page_size,
            sort_key,
            sort_direction,
        )

    @router.get("/source-systems", response_model=None)
    def get_source_systems(current_service: Any = Depends(get_service)):
        try:
            items = current_service.get_source_systems()
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"items": items}, SourceSystemListResponse))

    @router.get("/stats", response_model=None)
    def get_mapping_stats(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_stats(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract({"data": data}, DataEnvelope[MappingStats]))

    @router.get("/fields", response_model=None)
    def get_field_mappings(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_field_mappings(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract(data, FieldMappingListResponse))

    @router.get("/tables", response_model=None)
    def get_table_mappings(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_table_mappings(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract(data, FieldMappingTableListResponse))

    app.include_router(router)


def _asset_payload(payload: AssetTableRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_upstream_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/upstreams", tags=["upstream-migration"])

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
        return JSONResponse(
            content=validate_contract({"data": data}, UpstreamResponse)
        )

    @router.get("/systems/{system_id}/admin-detail", response_model=None)
    def get_system_admin_detail(
        system_id: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_system_admin_detail(system_id)
        except (UpstreamSystemNotFoundError, UpstreamDataSourceError) as error:
            return _upstream_error_response(error)
        return JSONResponse(
            content=validate_contract({"data": data}, UpstreamResponse)
        )

    @router.post("/systems", response_model=None, status_code=201)
    def create_system(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
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
        _context: RequestContext = Depends(require_maintainer),
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
        _context: RequestContext = Depends(require_maintainer),
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
        _context: RequestContext = Depends(require_maintainer),
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


def _register_system_management_routes(
    app: FastAPI,
    service: Any,
    operation_logs: Any,
) -> None:
    router = APIRouter(prefix="/api/system", tags=["system-management-migration"])

    def get_service() -> Any:
        return service

    def get_operation_logs_service() -> Any:
        return operation_logs

    @router.get("/users", response_model=None)
    def get_users(
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            payload = {"items": current_service.get_users()}
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract(payload, SystemResponse))

    @router.post("/users", response_model=None, status_code=201)
    def create_user(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_user(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "User created", "data": data}, SystemResponse
            ),
        )

    @router.put("/users/{username}", response_model=None)
    def update_user(
        username: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_user(username, _system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "User updated", "data": data}, SystemResponse
            )
        )

    @router.patch("/users/{username}/status", response_model=None)
    def patch_user_status(
        username: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            data = current_service.update_user_status(username, payload.get("status"))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "User status updated", "data": data}, SystemResponse
            )
        )

    @router.post("/users/{username}/reset-password", response_model=None)
    def reset_user_password(
        username: str,
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.reset_user_password(username)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "User reset completed", "data": data}, SystemResponse
            )
        )

    @router.delete("/users/{username}", response_model=None)
    def delete_user(
        username: str,
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_user(username)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "User deleted"}, SystemResponse)
        )

    @router.get("/menus", response_model=None)
    def get_menus(
        context: RequestContext = Depends(get_request_context),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_menus()
        except SystemManagementError as error:
            return _system_error_response(error)
        identity = context.identity
        if identity is None or identity.role != "admin":
            items = [
                item
                for item in items
                if item["status"] == "enabled"
                and (
                    not item["adminOnly"]
                    or (identity and identity.role == "maintainer" and item["code"] == "system")
                )
            ]
        return JSONResponse(
            content=validate_contract({"items": items}, SystemResponse)
        )

    @router.post("/menus", response_model=None, status_code=201)
    def create_menu(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_menu(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "Menu created", "data": data}, SystemResponse
            ),
        )

    @router.put("/menus/{menu_id}", response_model=None)
    def update_menu(
        menu_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_menu(menu_id, _system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Menu updated", "data": data}, SystemResponse
            )
        )

    @router.patch("/menus/{menu_id}/status", response_model=None)
    def patch_menu_status(
        menu_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            data = current_service.update_menu_status(menu_id, payload.get("status"))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Menu status updated", "data": data}, SystemResponse
            )
        )

    @router.patch("/menus/{menu_id}/move", response_model=None)
    def patch_menu_move(
        menu_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            items = current_service.move_menu(menu_id, payload.get("direction"))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Menu order updated", "items": items}, SystemResponse
            )
        )

    @router.delete("/menus/{menu_id}", response_model=None)
    def delete_menu(
        menu_id: str,
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_menu(menu_id)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "Menu deleted"}, SystemResponse)
        )

    @router.get("/param-dicts/categories", response_model=None)
    def get_param_categories(
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_param_dict_categories()
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"items": items}, SystemResponse)
        )

    @router.patch("/param-dicts/categories/{category_code}/status", response_model=None)
    def patch_param_category_status(
        category_code: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            data = current_service.update_param_category_status(
                category_code, payload.get("status")
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Category status updated", "data": data}, SystemResponse
            )
        )

    @router.get("/param-dicts", response_model=None)
    def get_param_dicts(
        category_code: str | None = Query(default=None, alias="categoryCode"),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_param_dicts(category_code)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"items": items}, SystemResponse)
        )

    @router.post("/param-dicts", response_model=None, status_code=201)
    def create_param_dict(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_param_dict(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "Parameter created", "data": data}, SystemResponse
            ),
        )

    @router.put("/param-dicts/{dict_id}", response_model=None)
    def update_param_dict(
        dict_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_param_dict(dict_id, _system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Parameter updated", "data": data}, SystemResponse
            )
        )

    @router.patch("/param-dicts/{dict_id}/status", response_model=None)
    def patch_param_dict_status(
        dict_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        payload = payload or {}
        try:
            data = current_service.update_param_dict_status(
                dict_id, payload.get("status")
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Parameter status updated", "data": data}, SystemResponse
            )
        )

    @router.delete("/param-dicts/{dict_id}", response_model=None)
    def delete_param_dict(
        dict_id: str,
        _context: RequestContext = Depends(require_admin),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_param_dict(dict_id)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "Parameter deleted"}, SystemResponse)
        )

    operation_router = APIRouter(
        prefix="/api/operation-logs", tags=["operation-log-migration"]
    )

    @operation_router.get("", response_model=None)
    def get_operation_logs(
        keyword: str | None = Query(default=None),
        module: str | None = Query(default=None),
        operation_type: str | None = Query(default=None, alias="operationType"),
        result: str | None = Query(default=None),
        start_time: str | None = Query(default=None, alias="startTime"),
        end_time: str | None = Query(default=None, alias="endTime"),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_operation_logs_service),
    ):
        filters = {
            "keyword": keyword,
            "module": module,
            "operationType": operation_type,
            "result": result,
            "startTime": start_time,
            "endTime": end_time,
            "page": page,
            "pageSize": page_size,
        }
        try:
            payload = current_service.get_logs(filters)
        except (OperationLogValidationError, OperationLogDataSourceError) as error:
            return _operation_log_error_response(error)
        return JSONResponse(content=validate_contract(payload, SystemResponse))

    @operation_router.get("/{log_id}", response_model=None)
    def get_operation_log_detail(
        log_id: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_operation_logs_service),
    ):
        try:
            data = current_service.get_log_detail(log_id)
        except (OperationLogNotFoundError, OperationLogDataSourceError) as error:
            return _operation_log_error_response(error)
        return JSONResponse(
            content=validate_contract({"data": data}, SystemResponse)
        )

    app.include_router(router)
    app.include_router(operation_router)


def _register_lineage_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/lineage", tags=["lineage-migration"])

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
    field_mapping_service_instance: Any | None = None,
    root_service_instance: Any | None = None,
    manual_code_table_service_instance: Any | None = None,
    report_service_instance: Any | None = None,
    api_asset_service_instance: Any | None = None,
    lineage_service_instance: Any | None = None,
    system_management_service_instance: Any | None = None,
    operation_log_service_instance: Any | None = None,
    upstream_service_instance: Any | None = None,
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
    field_mapping = field_mapping_service_instance or field_mapping_service
    root = root_service_instance or root_service
    manual_code_table = manual_code_table_service_instance or manual_code_table_service
    report = report_service_instance or report_service
    api_asset = api_asset_service_instance or api_asset_service
    lineage = lineage_service_instance or lineage_service
    system_management = system_management_service_instance or system_management_service
    operation_logs = operation_log_service_instance or operation_log_service
    upstream = upstream_service_instance or upstream_service

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
    if "mapping" in enabled_codes:
        _register_field_mapping_routes(app, field_mapping)
    if "root" in enabled_codes:
        _register_root_routes(app, root)
    if "codeTable" in enabled_codes:
        _register_manual_code_table_routes(app, manual_code_table)
    if "report" in enabled_codes:
        _register_report_routes(app, report)
    if "apiAsset" in enabled_codes:
        _register_api_asset_routes(app, api_asset)
    if "lineage" in enabled_codes:
        _register_lineage_routes(app, lineage)
    if "system" in enabled_codes:
        _register_system_management_routes(app, system_management, operation_logs)
    if "upstream" in enabled_codes:
        _register_upstream_routes(app, upstream)
    return app
