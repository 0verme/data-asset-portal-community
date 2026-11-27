"""System management FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, File, Query, UploadFile
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
from ...services.branding_service import (
    BrandingManagementError,
    BrandingNotFoundError,
    BrandingValidationError,
    default_public_branding,
)
from ...services.search_hot_keyword_service import (
    SearchHotKeywordAlreadyExistsError,
    SearchHotKeywordError,
    SearchHotKeywordNotFoundError,
    SearchHotKeywordValidationError,
)
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_permission,
)
from ..errors import _service_error_response
from ..public_catalog import is_authenticated_request, public_navigation_menus
from ...settings import get_public_catalog_profile
from ...utils.pagination import resolve_paging


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


def _branding_error_response(error: BrandingManagementError) -> JSONResponse:
    status = 404 if isinstance(error, BrandingNotFoundError) else 422 if isinstance(error, BrandingValidationError) else 500
    return _service_error_response(error, status)


def _search_hot_keyword_error_response(error: SearchHotKeywordError) -> JSONResponse:
    if isinstance(error, SearchHotKeywordNotFoundError):
        status = 404
    elif isinstance(error, SearchHotKeywordAlreadyExistsError):
        status = 409
    elif isinstance(error, SearchHotKeywordValidationError):
        status = 422
    else:
        status = 500
    return _service_error_response(error, status)


def _system_payload(payload: Any) -> Any:
    return payload


def _register_system_management_routes(
    app: FastAPI,
    service: Any,
    rag_search_service: Any | None = None,
    branding_service_instance: Any | None = None,
    search_hot_keyword_service_instance: Any | None = None,
) -> None:
    router = APIRouter(
        prefix="/api/system",
        tags=["system-management-migration"],
    )

    def get_service() -> Any:
        return service

    def get_branding_service() -> Any:
        if branding_service_instance is not None:
            return branding_service_instance
        from ...services.branding_service import branding_service

        return branding_service

    def get_search_hot_keyword_service() -> Any:
        if search_hot_keyword_service_instance is not None:
            return search_hot_keyword_service_instance
        from ...services.search_hot_keyword_service import search_hot_keyword_service

        return search_hot_keyword_service

    @router.get("/search-hot-keywords", response_model=None)
    def get_admin_search_hot_keywords(
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        try:
            items = current_hot_keyword_service.list_admin_items()
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            content=validate_contract({"items": items}, SystemResponse),
            headers={"Cache-Control": "no-store"},
        )

    @router.post("/search-hot-keywords", response_model=None, status_code=201)
    def create_admin_search_hot_keyword(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        try:
            item = current_hot_keyword_service.create_item(_system_payload(payload))
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "Search recommendation created", "data": item},
                SystemResponse,
            ),
            headers={"Cache-Control": "no-store"},
        )

    @router.post("/search-hot-keywords/restore-defaults", response_model=None)
    def restore_admin_search_hot_keyword_defaults(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        scope = payload.get("scope") if isinstance(payload, dict) else None
        try:
            items = current_hot_keyword_service.restore_defaults(scope)
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Search recommendation defaults restored", "items": items},
                SystemResponse,
            ),
            headers={"Cache-Control": "no-store"},
        )

    @router.put("/search-hot-keywords/{item_id}", response_model=None)
    def update_admin_search_hot_keyword(
        item_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        try:
            item = current_hot_keyword_service.update_item(item_id, _system_payload(payload))
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Search recommendation updated", "data": item},
                SystemResponse,
            ),
            headers={"Cache-Control": "no-store"},
        )

    @router.patch("/search-hot-keywords/{item_id}/status", response_model=None)
    def patch_admin_search_hot_keyword_status(
        item_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        try:
            item = current_hot_keyword_service.update_item_status(item_id, _system_payload(payload))
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Search recommendation status updated", "data": item},
                SystemResponse,
            ),
            headers={"Cache-Control": "no-store"},
        )

    @router.delete("/search-hot-keywords/{item_id}", response_model=None)
    def delete_admin_search_hot_keyword(
        item_id: str,
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_hot_keyword_service: Any = Depends(get_search_hot_keyword_service),
    ):
        try:
            current_hot_keyword_service.delete_item(item_id)
        except SearchHotKeywordError as error:
            return _search_hot_keyword_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "Search recommendation deleted"},
                SystemResponse,
            ),
            headers={"Cache-Control": "no-store"},
        )

    @router.get("/public-config", response_model=None)
    def get_public_site_config(
        lang: str = Query(default="zh-CN", max_length=5),
        current_branding_service: Any = Depends(get_branding_service),
    ):
        locale = lang if lang in {"zh-CN", "en-US"} else "zh-CN"
        try:
            data = current_branding_service.get_public_config(locale)
        except BrandingManagementError:
            # A broken/missing parameter row must never prevent the public SPA
            # from booting. The frontend retains its last good in-memory value
            # when the request itself fails.
            data = default_public_branding(locale)
        version = str(data.get("version") or "")
        return JSONResponse(
            content={"data": data},
            headers={
                "Cache-Control": "no-cache, must-revalidate",
                "ETag": f'W/"{version}"',
                "Vary": "Accept-Language",
            },
        )

    @router.get("/branding-config", response_model=None)
    def get_branding_config(
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_branding_service: Any = Depends(get_branding_service),
    ):
        try:
            data = current_branding_service.get_admin_config()
        except BrandingManagementError as error:
            return _branding_error_response(error)
        return JSONResponse(
            content={"data": data},
            headers={"Cache-Control": "no-store"},
        )

    @router.put("/branding-config", response_model=None)
    def update_branding_config(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_branding_service: Any = Depends(get_branding_service),
    ):
        try:
            data = current_branding_service.update_admin_config(_system_payload(payload))
        except BrandingManagementError as error:
            return _branding_error_response(error)
        return JSONResponse(
            content={"message": "Branding configuration updated", "data": data},
            headers={"Cache-Control": "no-store"},
        )

    @router.post("/branding-config/reset", response_model=None)
    def reset_branding_config(
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_branding_service: Any = Depends(get_branding_service),
    ):
        try:
            data = current_branding_service.reset_admin_config()
        except BrandingManagementError as error:
            return _branding_error_response(error)
        return JSONResponse(
            content={"message": "Branding defaults restored", "data": data},
            headers={"Cache-Control": "no-store"},
        )

    @router.post("/branding-config/assets/{kind}", response_model=None, status_code=201)
    async def upload_branding_asset(
        kind: str,
        file: UploadFile = File(...),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_branding_service: Any = Depends(get_branding_service),
    ):
        try:
            data = await file.read(200 * 1024 + 1)
            result = current_branding_service.upload_asset(
                kind,
                file.filename,
                file.content_type,
                data,
            )
        except BrandingManagementError as error:
            return _branding_error_response(error)
        finally:
            await file.close()
        return JSONResponse(
            status_code=201,
            content={"message": "Branding asset uploaded", "data": result},
            headers={"Cache-Control": "no-store"},
        )

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

    @router.get("/users/page", response_model=None)
    def get_users_page(
        keyword: str = Query(default=""),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        _context: RequestContext = Depends(require_permission("system:user:read")),
        current_service: Any = Depends(get_service),
    ):
        page, page_size = resolve_paging(page, page_size)
        try:
            payload = current_service.get_users_page(
                keyword=keyword,
                page=page,
                page_size=page_size,
            )
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

    @router.get("/roles/page", response_model=None)
    def get_roles_page(
        keyword: str = Query(default=""),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        _context: RequestContext = Depends(require_permission("system:role:read")),
        current_service: Any = Depends(get_service),
    ):
        page, page_size = resolve_paging(page, page_size)
        try:
            payload = current_service.get_roles_page(
                keyword=keyword,
                page=page,
                page_size=page_size,
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract(payload, SystemResponse))

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
        authenticated = is_authenticated_request(context, authorization)
        if not authenticated and get_public_catalog_profile() == "disabled":
            return JSONResponse(content=validate_contract({"items": []}, SystemResponse))
        try:
            items = current_service.get_menus()
            if not authenticated:
                items = public_navigation_menus(items)
        except SystemManagementError as error:
            return _system_error_response(error)
        # `adminOnly` remains presentation metadata for authenticated clients;
        # anonymous callers already receive the explicit public navigation
        # projection above. This endpoint is not an authorization engine.
        return JSONResponse(content=validate_contract({"items": items}, SystemResponse))

    @router.get("/menus/page", response_model=None)
    def get_menus_page(
        keyword: str = Query(default=""),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        _context: RequestContext = Depends(require_permission("system:menu:read")),
        current_service: Any = Depends(get_service),
    ):
        page, page_size = resolve_paging(page, page_size)
        try:
            payload = current_service.get_menus_page(
                keyword=keyword,
                page=page,
                page_size=page_size,
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract(payload, SystemResponse))

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

    @router.get("/rag-search-config", response_model=None)
    def get_rag_search_config(
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_rag_search_config_public()
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, SystemResponse))

    @router.put("/rag-search-config", response_model=None)
    def update_rag_search_config(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_rag_search_config(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(
            content=validate_contract(
                {"message": "RAG search configuration updated", "data": data},
                SystemResponse,
            )
        )

    @router.get("/rag-search-config/diagnostics", response_model=None)
    def get_rag_search_diagnostics(
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            config = current_service.get_rag_search_config()
        except SystemManagementError as error:
            return _system_error_response(error)
        if rag_search_service is None:
            diagnostics = {"status": "disabled", "reasonCode": "disabled"}
        else:
            diagnostics = rag_search_service.diagnostics(config)
        return JSONResponse(content=validate_contract({"data": diagnostics}, SystemResponse))

    @router.get("/ai-llm-daily-quota", response_model=None)
    def get_ai_llm_daily_quota(
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_ai_llm_daily_quota()
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract({"data": data}, SystemResponse))

    @router.put("/ai-llm-daily-quota", response_model=None)
    def update_ai_llm_daily_quota(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("system:param:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_ai_llm_daily_quota(_system_payload(payload))
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract(
            {"message": "Daily LLM quota updated", "data": data}, SystemResponse
        ))

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

    @router.get("/param-dicts/page", response_model=None)
    def get_param_dicts_page(
        category_code: str = Query(default="", alias="categoryCode"),
        keyword: str = Query(default=""),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        _context: RequestContext = Depends(require_permission("system:param:read")),
        current_service: Any = Depends(get_service),
    ):
        page, page_size = resolve_paging(page, page_size)
        try:
            payload = current_service.get_param_dicts_page(
                category_code=category_code or None,
                keyword=keyword,
                page=page,
                page_size=page_size,
            )
        except SystemManagementError as error:
            return _system_error_response(error)
        return JSONResponse(content=validate_contract(payload, SystemResponse))

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
