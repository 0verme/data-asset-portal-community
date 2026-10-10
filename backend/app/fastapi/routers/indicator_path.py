"""FastAPI adapter for the existing indicator path tree service."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import IndicatorPathTreeNode
from ...services.indicator_path_service import IndicatorPathDataSourceError
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_public_catalog_access,
)
from ..errors import _service_error_response
from ..public_catalog import profile_for_request, project_public_catalog_value


def _register_indicator_path_routes(app: FastAPI, service: Any) -> None:
    """Register the legacy-compatible read-only path-tree endpoint."""
    router = APIRouter(
        prefix="/api/indicator-path",
        tags=["indicator-path"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    def get_service() -> Any:
        return service

    @router.get(
        "/tree",
        response_model=list[IndicatorPathTreeNode],
        response_model_exclude_none=True,
        summary="查询指标路径树",
        description=(
            "返回 enabled 指标路径节点。可用 dimensionCode 按节点维度编码过滤；"
            "匹配不区分大小写并忽略首尾空格，响应保留匹配节点的祖先路径及其完整子树。"
        ),
    )
    def get_indicator_path_tree(
        dimension_code: str | None = Query(
            default=None,
            alias="dimensionCode",
            description=(
                "可选节点维度编码，大小写不敏感；匹配节点以树形形式返回，"
                "并包含必要祖先和该节点的后代。"
            ),
        ),
        current_service: Any = Depends(get_service),
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        try:
            items = current_service.get_path_tree(dimension_code=dimension_code)
        except IndicatorPathDataSourceError as error:
            return _service_error_response(error, 500)

        profile = profile_for_request(context, authorization)
        return project_public_catalog_value(items, profile=profile)

    app.include_router(router)
