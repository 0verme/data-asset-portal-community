"""Manual code table FastAPI adapter routes."""

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
    ManualCodeTableItem,
    ManualCodeTableListResponse,
    ManualCodeTableRequest,
    MessageDataResponse,
    validate_contract,
)
from ...services.manual_code_table_service import (
    ManualCodeTableAlreadyExistsError,
    ManualCodeTableDataSourceError,
    ManualCodeTableNotFoundError,
    ManualCodeTableValidationError,
)
from ..dependencies import require_authenticated, require_permission
from ..errors import _service_error_response


def _register_manual_code_table_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/manual-code-tables",
        tags=["manual-code-table-migration"],
        dependencies=[Depends(require_authenticated)],
    )
    style_labels = {
        "enum": "标准枚举",
        "dim": "维度字典",
        "status": "状态流转",
        "map": "业务映射",
        "custom": "自定义结构",
    }
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
            items = current_service.get_tables(
                keyword=keyword, style=style, status=status
            )
        except (
            ManualCodeTableValidationError,
            ManualCodeTableDataSourceError,
        ) as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract({"items": items}, ManualCodeTableListResponse)
        )

    @router.get("/export", response_model=None)
    def export_manual_code_tables(
        keyword: str | None = Query(default=None),
        style: str | None = Query(default=None),
        status: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_tables(
                keyword=keyword, style=style, status=status
            )
        except (
            ManualCodeTableValidationError,
            ManualCodeTableDataSourceError,
        ) as error:
            return error_response(error)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            ["表编码", "表名称", "表样式", "负责人", "状态", "说明", "更新时间"]
        )
        for item in items:
            writer.writerow(
                [
                    item["tableCode"],
                    item["tableName"],
                    style_labels.get(item["style"], item["style"]),
                    item["owner"],
                    status_labels.get(item["status"], item["status"]),
                    item["remark"],
                    item["updatedAt"],
                ]
            )
        return Response(
            "\ufeff" + output.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=manual-code-tables.csv"
            },
        )

    @router.get("/{table_id}", response_model=None)
    def get_manual_code_table(
        table_id: str, current_service: Any = Depends(get_service)
    ):
        try:
            data = current_service.get_table(table_id)
        except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[ManualCodeTableItem])
        )

    @router.post("", response_model=None, status_code=201)
    def create_manual_code_table(
        payload: ManualCodeTableRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("code_table:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_table(manual_payload(payload))
        except (
            ManualCodeTableAlreadyExistsError,
            ManualCodeTableValidationError,
            ManualCodeTableDataSourceError,
        ) as error:
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
        _context: RequestContext = Depends(require_permission("code_table:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_table(table_id, manual_payload(payload))
        except (
            ManualCodeTableNotFoundError,
            ManualCodeTableAlreadyExistsError,
            ManualCodeTableValidationError,
            ManualCodeTableDataSourceError,
        ) as error:
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
        _context: RequestContext = Depends(require_permission("code_table:write")),
        current_service: Any = Depends(get_service),
    ):
        body = manual_payload(payload) or {}
        try:
            data = current_service.update_status(table_id, body.get("status"))
        except (
            ManualCodeTableNotFoundError,
            ManualCodeTableValidationError,
            ManualCodeTableDataSourceError,
        ) as error:
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
        _context: RequestContext = Depends(require_permission("code_table:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_table(table_id)
        except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
            return error_response(error)
        return Response(status_code=204)

    app.include_router(router)
