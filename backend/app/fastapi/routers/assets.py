"""Data asset FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    AssetField,
    AssetItem,
    AssetPageResponse,
    AssetTableRequest,
    DataEnvelope,
    ItemsResponse,
    MessageDataResponse,
    validate_contract,
)
from ...services.assets_service import (
    AssetAlreadyExistsError,
    AssetDataSourceError,
    AssetNotFoundError,
    AssetValidationError,
)
from ..dependencies import require_permission
from ..errors import _service_error_response


def _asset_payload(payload: AssetTableRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_asset_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/assets",
        tags=["assets-migration"],
    )

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
        response_model = (
            AssetPageResponse if "page" in payload else ItemsResponse[AssetItem]
        )
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
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[AssetItem])
        )

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
        return JSONResponse(
            content=validate_contract({"items": items}, ItemsResponse[AssetField])
        )

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
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[object])
        )

    @router.get("/domains", response_model=None)
    def get_domains(
        layer: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_domains(layer=layer)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, ItemsResponse[object])
        )

    @router.get("/layers", response_model=None)
    def get_layers(
        domain: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_layers(domain=domain)
        except AssetDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, ItemsResponse[object])
        )

    @router.post("/tables", response_model=None, status_code=201)
    def create_asset_table(
        payload: AssetTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("asset:write")),
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
        _context: RequestContext = Depends(require_permission("asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_asset_table(
                table_name, _asset_payload(payload)
            )
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
        _context: RequestContext = Depends(require_permission("asset:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_asset_fields(
                table_name, _asset_payload(payload)
            )
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
        _context: RequestContext = Depends(require_permission("asset:write")),
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
