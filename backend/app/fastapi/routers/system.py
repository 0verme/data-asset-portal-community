"""System management FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import SystemResponse, validate_contract
from ...services.system_management_service import (
    MenuAlreadyExistsError,
    MenuNotFoundError,
    ParamCategoryNotFoundError,
    ParamDictAlreadyExistsError,
    ParamDictNotFoundError,
    SystemDataSourceError,
    SystemManagementError,
    SystemRoleAlreadyExistsError,
    SystemRoleAssignedError,
    SystemRoleNotFoundError,
    SystemRoleProtectedError,
    SystemUserAlreadyExistsError,
    SystemUserNotFoundError,
    SystemValidationError,
)
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_permission,
)
from ..errors import _service_error_response
from ..public_catalog import is_authenticated_request, public_navigation_menus


def _system_error_status(error: SystemManagementError) -> int:
    if isinstance(
        error,
        (
            MenuNotFoundError,
            ParamCategoryNotFoundError,
            ParamDictNotFoundError,
            SystemRoleNotFoundError,
            SystemUserNotFoundError,
        ),
    ):
        return 404
    if isinstance(
        error,
        (
            MenuAlreadyExistsError,
            ParamDictAlreadyExistsError,
            SystemRoleAlreadyExistsError,
            SystemRoleAssignedError,
            SystemRoleProtectedError,
            SystemUserAlreadyExistsError,
        ),
    ):
        return 409
    if isinstance(error, SystemValidationError):
        return 422
    if isinstance(error, SystemDataSourceError):
        return 500
    return 500


def _system_error_response(error: SystemManagementError) -> JSONResponse:
    return _service_error_response(error, _system_error_status(error))


def _system_payload(payload: Any) -> Any:
    return payload


def _register_system_management_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/system",
        tags=["system-management-migration"],
    )

    def get_service() -> Any:
        return service

    @router.get("/users", response_model=None)
    def get_users(
        _context: RequestContext = Depends(require_permission("system:user:read")),
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
        _context: RequestContext = Depends(require_permission("system:user:write")),
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

    @router.patch("/users/{username}/role", response_model=None)
    def patch_user_role(
        username: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:user:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_user_role(username, _system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "User role updated", "data": data}, SystemResponse
            )
        )

    @router.put("/users/{username}", response_model=None)
    def update_user(
        username: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:user:write")),
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
        _context: RequestContext = Depends(require_permission("system:user:write")),
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
        _context: RequestContext = Depends(require_permission("system:user:write")),
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
        _context: RequestContext = Depends(require_permission("system:user:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_user(username)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "User deleted"}, SystemResponse)
        )

    @router.get("/permissions", response_model=None)
    def get_permissions(
        assignable_only: bool = Query(default=False, alias="assignableOnly"),
        _context: RequestContext = Depends(require_permission("system:role:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = (
                current_service.get_role_assignable_permissions()
                if assignable_only
                else current_service.get_permissions()
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.get("/roles", response_model=None)
    def get_roles(
        _context: RequestContext = Depends(require_permission("system:role:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_roles()
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.post("/roles", response_model=None, status_code=201)
    def create_role(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:role:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_role(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract({"message": "Role created", "data": data}, SystemResponse),
        )

    @router.put("/roles/{role_code}", response_model=None)
    def update_role(
        role_code: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:role:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_role(role_code, _system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "Role updated", "data": data}, SystemResponse)
        )

    @router.delete("/roles/{role_code}", response_model=None)
    def delete_role(
        role_code: str,
        _context: RequestContext = Depends(require_permission("system:role:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_role(role_code)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"message": "Role deleted"}, SystemResponse))

    @router.get("/menus", response_model=None)
    def get_menus(
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            items = current_service.get_menus()
            if not is_authenticated_request(context, authorization):
                items = public_navigation_menus(items)
        except SystemManagementError as error:
            return _system_error_response(error)
        # `adminOnly` remains presentation metadata for authenticated clients;
        # anonymous callers already receive the explicit public navigation
        # projection above. This endpoint is not an authorization engine.
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.post("/menus", response_model=None, status_code=201)
    def create_menu(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:menu:write")),
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
        _context: RequestContext = Depends(require_permission("system:menu:write")),
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
        _context: RequestContext = Depends(require_permission("system:menu:write")),
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
        _context: RequestContext = Depends(require_permission("system:menu:write")),
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
        _context: RequestContext = Depends(require_permission("system:menu:write")),
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
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_param_dict_categories()
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.patch("/param-dicts/categories/{category_code}/status", response_model=None)
    def patch_param_category_status(
        category_code: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
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
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_param_dicts(category_code)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.post("/param-dicts", response_model=None, status_code=201)
    def create_param_dict(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
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
        _context: RequestContext = Depends(require_permission("system:param:write")),
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
        _context: RequestContext = Depends(require_permission("system:param:write")),
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
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_param_dict(dict_id)
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract({"message": "Parameter deleted"}, SystemResponse)
        )

    app.include_router(router)
