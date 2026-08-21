"""Report FastAPI adapter routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    DataEnvelope,
    MessageDataResponse,
    ReportItem,
    ReportListResponse,
    ReportRequest,
    validate_contract,
)
from ...services.report_service import (
    ReportAlreadyExistsError,
    ReportDataSourceError,
    ReportNotFoundError,
    ReportValidationError,
)
from ..dependencies import require_maintainer
from ..errors import _service_error_response

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
