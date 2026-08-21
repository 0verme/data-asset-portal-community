"""Indicator FastAPI adapter routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse

from ...application import RequestContext
from ...contracts import (
    DataEnvelope,
    IndicatorItem,
    IndicatorListResponse,
    IndicatorRequest,
    MessageDataResponse,
    validate_contract,
)
from ...services.indicator_service import (
    IndicatorAlreadyExistsError,
    IndicatorDataSourceError,
    IndicatorNotFoundError,
    IndicatorValidationError,
)
from ..dependencies import require_maintainer
from ..errors import _service_error_response

def _indicator_payload(payload: IndicatorRequest | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return payload.model_dump(by_alias=True, exclude_unset=True)


def _register_indicator_routes(app: FastAPI, service: Any) -> None:
    router = APIRouter(prefix="/api/indicators", tags=["indicator-pilot"])

    def get_service() -> Any:
        return service

    @router.get("", response_model=None)
    def get_indicators(
        keyword: str | None = Query(default=None),
        dimension: str | None = Query(default=None),
        status: str | None = Query(default=None),
        current_service: Any = Depends(get_service),
    ):
        try:
            items = current_service.get_indicators(
                keyword=keyword,
                dimension=dimension,
                status=status,
            )
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"items": items}, IndicatorListResponse)
        )

    @router.get("/{indicator_id}", response_model=None)
    def get_indicator_detail(
        indicator_id: str,
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.get_indicator_detail(indicator_id)
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract({"data": data}, DataEnvelope[IndicatorItem])
        )

    @router.post("", response_model=None, status_code=201)
    def create_indicator(
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.create_indicator(_indicator_payload(payload))
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            status_code=201,
            content=validate_contract(
                {"message": "指标创建成功", "data": data},
                MessageDataResponse[IndicatorItem],
            ),
        )

    @router.put("/{indicator_id}", response_model=None)
    def update_indicator(
        indicator_id: str,
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            data = current_service.update_indicator(
                indicator_id,
                _indicator_payload(payload),
            )
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorAlreadyExistsError as error:
            return _service_error_response(error, 409)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "指标更新成功", "data": data},
                MessageDataResponse[IndicatorItem],
            )
        )

    @router.patch("/{indicator_id}/status", response_model=None)
    def patch_indicator_status(
        indicator_id: str,
        payload: IndicatorRequest | None = Body(default=None),
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        body = _indicator_payload(payload) or {}
        try:
            data = current_service.patch_status(indicator_id, body.get("status"))
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorValidationError as error:
            return _service_error_response(error, 422)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(
            content=validate_contract(
                {"message": "指标状态更新成功", "data": data},
                MessageDataResponse[IndicatorItem],
            )
        )

    @router.delete("/{indicator_id}", response_model=None)
    def delete_indicator(
        indicator_id: str,
        _context: RequestContext = Depends(require_maintainer),
        current_service: Any = Depends(get_service),
    ):
        try:
            current_service.delete_indicator(indicator_id)
        except IndicatorNotFoundError as error:
            return _service_error_response(error, 404)
        except IndicatorDataSourceError as error:
            return _service_error_response(error, 500)
        return JSONResponse(content={"message": "指标删除成功"})

    app.include_router(router)
