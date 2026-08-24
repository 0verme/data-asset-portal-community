"""Root FastAPI adapter routes."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    DataEnvelope,
    MessageDataResponse,
    RootCategoryListResponse,
    RootItem,
    RootListResponse,
    RootRequest,
    validate_contract,
)
from ...services.root_service import (
    RootAlreadyExistsError,
    RootDataSourceError,
    RootNotFoundError,
    RootValidationError,
)
from ..dependencies import require_authenticated, require_permission
from ..errors import _service_error_response


def _register_root_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/roots",
        tags=["root-migration"],
        dependencies=[Depends(require_authenticated)],
    )

    def get_service() -> Any:
        return service

    def root_payload(payload: RootRequest | None) -> dict[str, Any] | None:
        if payload is None:
            return None
        return payload.model_dump(exclude_unset=True)

    @router.get("", response_model=None)
    def get_roots(
        keyword: str | None = Query(default=None),
        cat: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_roots(keyword=keyword, cat=cat)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, RootListResponse)
        )

    @router.get("/categories", response_model=None)
    def get_root_categories(current_service: Any = Depends(get_service)):
        try:
            items = current_service.get_root_categories()
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, RootCategoryListResponse)
        )

    @router.get("/{abbr}", response_model=None)
    def get_root_detail(abbr: str, current_service: Any = Depends(get_service)):
        try:
            data = current_service.get_root_detail(abbr)
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[RootItem])
        )

    @router.post("", response_model=None, status_code=201)
    def create_root(
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("root:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_root(root_payload(payload))
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "词根创建成功", "data": data},
                MessageDataResponse[RootItem],
            ),
        )

    @router.put("/{abbr}", response_model=None)
    def update_root(
        abbr: str,
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("root:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_root(abbr, root_payload(payload))
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "词根更新成功", "data": data},
                MessageDataResponse[RootItem],
            )
        )

    @router.delete("/{abbr}", response_model=None)
    def delete_root(
        abbr: str,
        _context: RequestContext = Depends(require_permission("root:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_root(abbr)
        except RootNotFoundError as error:
            return _service_error_response(error, 404)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content={"message": "词根删除成功"})

    @router.post("/import", response_model=None)
    def import_root_items(
        payload: RootRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_permission("root:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.import_roots(root_payload(payload))
        except RootValidationError as error:
            return _service_error_response(error, 422)
        except RootAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except RootDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "词根导入成功", "data": data},
                MessageDataResponse[object],
            )
        )

    app.include_router(router)
