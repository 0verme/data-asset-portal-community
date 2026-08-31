# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""FastAPI adapter for the existing downstream push service."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import (  # pyright: ignore[reportAttributeAccessIssue, reportMissingImports]
    APIRouter,
    Body,
    Depends,
    FastAPI,
    Query,
)
from fastapi.responses import JSONResponse  # pyright: ignore[reportMissingImports]

from ...application import RequestContext
from ...services.push_service import (
    PushDataSourceError,
    PushJobAlreadyExistsError,
    PushJobNotFoundError,
    PushSystemAlreadyExistsError,
    PushSystemInUseError,
    PushSystemNotFoundError,
    PushValidationError,
)
from ..dependencies import get_authorization_service, get_request_context, require_permission
from ..errors import _service_error_response
from ..public_catalog import is_authenticated_request, redact_public_push_system


def _push_error_status(error: Any) -> int:
    if isinstance(error, (PushSystemNotFoundError, PushJobNotFoundError)):
        return 404
    if isinstance(
        error,
        (PushSystemAlreadyExistsError, PushJobAlreadyExistsError, PushSystemInUseError),
    ):
        return 409
    if isinstance(error, PushValidationError):
        return 422
    return 500


def _push_error_response(error: Any) -> JSONResponse:
    return _service_error_response(error, _push_error_status(error))


def _register_push_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(
        prefix="/api/push",
        tags=["push"],
    )

    def get_service() -> Any:
        return service

    @router.get("/systems", response_model=None)
    def get_systems(
        status: str | None = Query(default=None),
        protocol: str | None = Query(default=None),
        dept: str | None = Query(default=None),
        keyword: str | None = Query(default=None),
        page: str | None = Query(default=None),
        page_size: str | None = Query(default=None, alias="pageSize"),
        limit: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
        context: Any = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            items = current_service.get_push_systems(
                status=status,
                protocol=protocol,
                dept=dept,
                keyword=keyword,
                page=page,
                page_size=page_size or limit,
            )
        except Exception as error:
            if isinstance(error, (PushDataSourceError, PushSystemNotFoundError)):
                return _push_error_response(error)
            raise
        if not is_authenticated_request(context, authorization):
            items = [redact_public_push_system(item) for item in items]
        return JSONResponse(content={"items": items})

    @router.get("/systems/{system_id}/admin-detail", response_model=None)
    def get_system_admin_detail(
        system_id: str,
        _context: RequestContext = Depends(require_permission("push:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_push_system_admin_detail(system_id)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"data": data})

    @router.get("/systems/{system_id}", response_model=None)
    def get_system_detail(
        system_id: str,
        current_service: Any = Depends(get_service),
        context: Any = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            data = current_service.get_push_system_detail(system_id)
            if not is_authenticated_request(context, authorization):
                data = redact_public_push_system(data)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"data": data})

    @router.post("/systems", response_model=None, status_code=201)
    def create_system(
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_push_system(payload)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(
            status_code=201, content={"message": "下游系统创建成功", "data": data}
        )

    @router.put("/systems/{system_id}", response_model=None)
    def update_system(
        system_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_push_system(system_id, payload)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"message": "下游系统更新成功", "data": data})

    @router.delete("/systems/{system_id}", response_model=None)
    def delete_system(
        system_id: str,
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_push_system(system_id)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"message": "下游系统删除成功"})

    @router.post("/systems/{system_id}/jobs", response_model=None, status_code=201)
    def create_job(
        system_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_push_job(system_id, payload)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(
            status_code=201, content={"message": "推送作业创建成功", "data": data}
        )

    @router.put("/systems/{system_id}/jobs/{job_id}", response_model=None)
    def update_job(
        system_id: str,
        job_id: str,
        payload: Any = Body(default=None),
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_push_job(system_id, job_id, payload)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"message": "推送作业更新成功", "data": data})

    @router.delete("/systems/{system_id}/jobs/{job_id}", response_model=None)
    def delete_job(
        system_id: str,
        job_id: str,
        _context: RequestContext = Depends(require_permission("push:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_push_job(system_id, job_id)
        except Exception as error:
            return _push_error_response(error)
        return JSONResponse(content={"message": "推送作业删除成功"})

    app.include_router(router)
