"""Field mapping FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    DataEnvelope,
    FieldMappingImportRequest,
    FieldMappingImportResponse,
    FieldMappingListResponse,
    FieldMappingTableListResponse,
    MappingStats,
    SourceSystemListResponse,
    validate_contract,
)
from ...services.field_mapping_service import FieldMappingDataSourceError
from ..dependencies import require_permission
from ..errors import _service_error_response


def _register_field_mapping_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/field-mappings",
        tags=["field-mapping-migration"],
    )

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
            "upstreamSystemId": data_source_id
            or upstream_system_id
            or source_system_id,
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

    @router.post("/import", response_model=None)
    def import_field_mappings(
        payload: FieldMappingImportRequest = Body(...),
        _context: RequestContext = Depends(require_permission("field_mapping:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.import_mappings(payload)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content=validate_contract(data, FieldMappingImportResponse))

    @router.get("/source-systems", response_model=None)
    def get_source_systems(current_service: Any = Depends(get_service)):
        try:
            items = current_service.get_source_systems()
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, SourceSystemListResponse)
        )

    @router.get("/stats", response_model=None)
    def get_mapping_stats(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_stats(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[MappingStats])
        )

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
        return JSONResponse(
            content=validate_contract(data, FieldMappingTableListResponse)
        )

    app.include_router(router)
