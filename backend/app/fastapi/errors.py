"""Shared FastAPI error envelope and application-level handlers."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..application.errors import ApplicationError
from ..contracts import ErrorEnvelope, validate_contract

LOGGER = logging.getLogger(__name__)

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


def register_exception_handlers(app: FastAPI) -> None:
    """Register the adapter's unchanged app-level exception handlers."""

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
