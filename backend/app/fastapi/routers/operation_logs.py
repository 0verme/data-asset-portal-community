"""Operation log FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import SystemResponse, validate_contract
from ...services.operation_log_service import (
    OperationLogDataSourceError,
    OperationLogNotFoundError,
    OperationLogValidationError,
)
from ..dependencies import require_authenticated, require_permission
from ..errors import _service_error_response


def _operation_log_error_response(error: Any) -> JSONResponse:
    if isinstance(error, OperationLogValidationError):
        status = 422
    elif isinstance(error, OperationLogNotFoundError):
        status = 404
    else:
        status = 500
    return _service_error_response(error, status)


# The module owns its router and handlers. The application factory supplies the
# service through ``app.state`` so production composition and test overrides use
# the same explicit seam without recreating the router per application instance.
router = APIRouter(
    prefix="/api/operation-logs",
    tags=["operation-log-migration"],
    dependencies=[Depends(require_authenticated)],
)


def get_operation_logs_service(request: Request) -> Any:
    """Resolve the explicitly composed operation-log service for this app."""
    return request.app.state.operation_log_service


require_operation_log_read = require_permission("operation_log:read")


@router.get("", response_model=None)
def get_operation_logs(
    keyword: str | None = Query(default=None),
    module: str | None = Query(default=None),
    operation_type: str | None = Query(default=None, alias="operationType"),
    result: str | None = Query(default=None),
    start_time: str | None = Query(default=None, alias="startTime"),
    end_time: str | None = Query(default=None, alias="endTime"),
    page: str | None = Query(default=None),
    page_size: str | None = Query(default=None, alias="pageSize"),
    _context: RequestContext = Depends(require_operation_log_read),
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


@router.get("/{log_id}", response_model=None)
def get_operation_log_detail(
    log_id: str,
    _context: RequestContext = Depends(require_operation_log_read),
    current_service: Any = Depends(get_operation_logs_service),
):
    try:
        data = current_service.get_log_detail(log_id)
    except (OperationLogNotFoundError, OperationLogDataSourceError) as error:
        return _operation_log_error_response(error)
    return JSONResponse(content=validate_contract({"data": data}, SystemResponse))
