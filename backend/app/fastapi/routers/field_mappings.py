"""Field mapping FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse, Response

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
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_catalog_export,
    require_permission,
    require_public_catalog_access,
)
from ..public_catalog import profile_for_request, project_public_catalog_value
from ..errors import _service_error_response


def _register_field_mapping_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/field-mappings",
        tags=["field-mapping-migration"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    def get_service() -> Any:
        return service

    def project_for_request(value: Any, context: RequestContext, authorization: Any) -> Any:
        return project_public_catalog_value(
            value, profile=profile_for_request(context, authorization)
        )

    def build_params(
        keyword: str | None,
        data_source_id: str | None,
        upstream_system_id: str | None,
        source_system_id: str | None,
        source_system_id_snake: str | None,
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
            # sourceSystemId is the canonical primary-key filter. Keep the
            # legacy aliases separate so dataSourceId is never mistaken for
            # an upstream_system primary key.
            "sourceSystemId": source_system_id or source_system_id_snake,
            "upstreamSystemId": upstream_system_id,
            "dataSourceId": data_source_id,
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
        source_system_id_snake: str | None = Query(
            default=None, alias="source_system_id"
        ),
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
            source_system_id_snake,
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
    def get_source_systems(
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            items = current_service.get_source_systems()
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        items = project_for_request(items, context, authorization)
        return JSONResponse(
            content=validate_contract({"items": items}, SourceSystemListResponse)
        )

    @router.get("/stats", response_model=None)
    def get_mapping_stats(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            data = current_service.get_stats(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        data = project_for_request(data, context, authorization)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[MappingStats])
        )

    @router.get("/export", response_model=None)
    def export_field_mappings(
        view: str = Query(default="field"),
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
        _export_access: RequestContext = Depends(
            require_catalog_export("field_mapping:read")
        ),
    ):
        if view not in {"field", "table"}:
            return JSONResponse(
                status_code=400,
                content={"error": {"code": "invalid_export_view", "message": "view must be field or table"}},
            )
        try:
            data = (
                current_service.get_field_mappings(params)
                if view == "field"
                else current_service.get_table_mappings(params)
            )
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        data = project_for_request(data, context, authorization)
        contract = FieldMappingListResponse if view == "field" else FieldMappingTableListResponse
        validate_contract(data, contract)

        field_columns = (
            ("源系统", "srcSystem"),
            ("源系统表", "srcTable"),
            ("源字段", "srcField"),
            ("字段类型", "srcType"),
            ("字段注释", "srcComment"),
            ("DWF 表名", "targetTable"),
            ("DWF 字段", "targetField"),
            ("映射规则", "mappingRule"),
        )
        table_columns = (
            ("源系统", "srcSystem"),
            ("源系统表", "srcTable"),
            ("表中文名", "srcTableCn"),
            ("DWF 表名", "targetTable"),
            ("入仓方式", "loadMode"),
            ("已映射", "mappedCount"),
            ("空注释率", "emptyCommentRate"),
        )
        columns = field_columns if view == "field" else table_columns
        load_mode_labels = {
            "full": "全量",
            "incr": "增量",
            "incr_zip": "增量拉链",
            "full_zip": "全量拉链",
        }
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\r\n")
        writer.writerow([label for label, _key in columns])
        for item in data.get("items", []):
            name = str(item.get("systemName") or item.get("srcSystem") or "").strip()
            code = str(item.get("systemCode") or item.get("systemAbbr") or "").strip()
            item_values = {**item, "srcSystem": f"{name} · {code}" if name and code else name or code}
            if view == "table":
                item_values["loadMode"] = load_mode_labels.get(item_values.get("loadMode"), "")
            cells = []
            for _label, key in columns:
                value = item_values.get(key, "")
                text = "" if value is None else str(value)
                if text.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
                    text = "'" + text
                cells.append(text)
            writer.writerow(cells)
        file_name = f"field-mappings-{view}.csv"
        return Response(
            content="\ufeff" + output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
        )

    @router.get("/fields", response_model=None)
    def get_field_mappings(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            data = current_service.get_field_mappings(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        data = project_for_request(data, context, authorization)
        return JSONResponse(content=validate_contract(data, FieldMappingListResponse))

    @router.get("/tables", response_model=None)
    def get_table_mappings(
        params: dict[str, str | None] = Depends(mapping_query_parameters),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            data = current_service.get_table_mappings(params)
        except FieldMappingDataSourceError as error:
            return _service_error_response(error, 500)
        data = project_for_request(data, context, authorization)
        return JSONResponse(
            content=validate_contract(data, FieldMappingTableListResponse)
        )

    app.include_router(router)
