"""FastAPI-native authentication routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import (  # pyright: ignore[reportAttributeAccessIssue]
    APIRouter,
    Body,
    Depends,
    FastAPI,
)
from fastapi.responses import JSONResponse  # pyright: ignore[reportMissingImports]

from ...application import (
    RequestContext,
    identity_for_session,
    set_current_request_identity,
)
from ...authorization.core import AuthorizationService
from ...services.auth_service import AuthError, AuthValidationError
from ...services.operation_log_service import (
    OPERATION_TYPE_LOGIN,
    OPERATION_TYPE_LOGOUT,
)
from ...security.login_protection import LoginAttemptLimiter
from ..auth import clear_native_session_cookie, set_native_session_cookie
from ..dependencies import get_authorization_service, get_request_context

MODULE_LOGIN = "系统登录"
LOGIN_RATE_LIMIT_CODE = "TOO_MANY_LOGIN_ATTEMPTS"
LOGIN_RATE_LIMIT_MESSAGE = "登录尝试过于频繁，请稍后重试。"


def _auth_payload(
    identity: Any,
    service: AuthorizationService,
    user: dict[str, Any],
) -> dict[str, Any]:
    current = service.current_subject(identity)
    payload = dict(user)
    if current is not None and current.role_code:
        payload["role"] = current.role_code
    payload["permissions"] = list(service.get_permissions(identity))
    return payload


def _register_auth_routes(
    app: FastAPI,
    auth_service: Any,
    operation_logs: Any,
    login_protection: LoginAttemptLimiter,
) -> None:
    auth_router = APIRouter(prefix="/api/auth", tags=["auth-native"])

    @auth_router.post("/login")
    def login(
        payload: dict[str, Any] | None = Body(default=None),
        _context: RequestContext = Depends(get_request_context),
        authorization: AuthorizationService = Depends(get_authorization_service),
    ):
        data = payload or {}
        username = str(data.get("username") or "").strip()
        decision = login_protection.check(username, _context.client_address)
        if not decision.allowed:
            operation_logs.record_best_effort_audit(
                module_name=MODULE_LOGIN,
                operation_type=OPERATION_TYPE_LOGIN,
                operation_object=username,
                operation_desc="管理员登录暂时受限",
                result_status="failure",
                error_message=LOGIN_RATE_LIMIT_MESSAGE,
                user_id=username,
                user_name=username,
            )
            response = JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": LOGIN_RATE_LIMIT_CODE,
                        "message": LOGIN_RATE_LIMIT_MESSAGE,
                    }
                },
            )
            response.headers["Retry-After"] = str(decision.retry_after_seconds)
            return response
        try:
            user = auth_service.authenticate(
                data.get("username"), data.get("password")
            )
        except AuthError as error:
            if isinstance(error, AuthValidationError):
                login_protection.record_failure(username, _context.client_address)
            operation_logs.record_best_effort_audit(
                module_name=MODULE_LOGIN,
                operation_type=OPERATION_TYPE_LOGIN,
                operation_object=username,
                operation_desc="管理员登录失败",
                result_status="failure",
                error_message=error.message,
                user_id=username,
                user_name=username,
            )
            return JSONResponse(
                status_code=error.status_code,
                content={"error": error.to_dict()},
            )

        login_protection.record_success(username, _context.client_address)
        identity = identity_for_session(user)
        user = _auth_payload(identity, authorization, user)
        set_current_request_identity(identity)
        operation_logs.record_best_effort_audit(
            module_name=MODULE_LOGIN,
            operation_type=OPERATION_TYPE_LOGIN,
            operation_object=user.get("user") or username,
            operation_desc="管理员登录系统",
        )
        response = JSONResponse(content={"message": "登录成功", "data": user})
        set_native_session_cookie(response, user, bool(data.get("remember")))
        return response

    @auth_router.get("/me")
    def current_user(
        context: RequestContext = Depends(get_request_context),
        authorization: AuthorizationService = Depends(get_authorization_service),
    ):
        if context.identity is None:
            return JSONResponse(
                status_code=401,
                content={
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "当前未登录。",
                    }
                },
            )
        decision = authorization.authenticate(context.identity)
        if not decision.authenticated:
            return JSONResponse(
                status_code=401,
                content={
                    "error": {
                        "code": "UNAUTHORIZED",
                        "message": "当前登录已失效。",
                    }
                },
            )
        current = decision.subject
        data: dict[str, Any] = dict(context.identity.as_dict())
        if current is not None:
            data["user"] = current.username
            data["role"] = current.role_code
        data["permissions"] = list(authorization.get_permissions(context.identity))
        return JSONResponse(content={"data": data})

    @auth_router.post("/logout")
    def logout(
        context: RequestContext = Depends(get_request_context),
    ):
        current = context.identity
        if current is not None:
            operation_logs.record_best_effort_audit(
                module_name=MODULE_LOGIN,
                operation_type=OPERATION_TYPE_LOGOUT,
                operation_object=current.user or "",
                operation_desc="管理员退出登录",
                user_id=current.user or "",
                user_name=current.name or current.user or "",
            )
        set_current_request_identity(None)
        response = JSONResponse(content={"message": "已退出登录"})
        clear_native_session_cookie(response)
        return response

    app.include_router(auth_router)
