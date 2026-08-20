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

from flask import Blueprint, jsonify, request

from ..auth import require_maintainer
from ..contracts import (
    DataEnvelope,
    ErrorEnvelope,
    IndicatorItem,
    IndicatorListResponse,
    MessageDataResponse,
    validate_contract,
)
from ..services.indicator_service import (
    IndicatorAlreadyExistsError,
    IndicatorDataSourceError,
    IndicatorNotFoundError,
    IndicatorValidationError,
    indicator_service,
)


indicator_bp = Blueprint("indicators", __name__)


def _error_response(error, status):
    payload = validate_contract({"error": error.to_dict()}, ErrorEnvelope)
    return jsonify(payload), status


@indicator_bp.get("")
def get_indicators():
    try:
        items = indicator_service.get_indicators(
            keyword=request.args.get("keyword"),
            dimension=request.args.get("dimension"),
            status=request.args.get("status"),
        )
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify(validate_contract({"items": items}, IndicatorListResponse))


@indicator_bp.get("/<indicator_id>")
def get_indicator_detail(indicator_id):
    try:
        data = indicator_service.get_indicator_detail(indicator_id)
    except IndicatorNotFoundError as error:
        return _error_response(error, 404)
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify(validate_contract({"data": data}, DataEnvelope[IndicatorItem]))


@indicator_bp.post("")
@require_maintainer
def create_indicator():
    try:
        data = indicator_service.create_indicator(request.get_json(silent=True))
    except IndicatorValidationError as error:
        return _error_response(error, 422)
    except IndicatorAlreadyExistsError as error:
        return _error_response(error, 409)
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify(
        validate_contract(
            {"message": "指标创建成功", "data": data},
            MessageDataResponse[IndicatorItem],
        )
    ), 201


@indicator_bp.put("/<indicator_id>")
@require_maintainer
def update_indicator(indicator_id):
    try:
        data = indicator_service.update_indicator(indicator_id, request.get_json(silent=True))
    except IndicatorNotFoundError as error:
        return _error_response(error, 404)
    except IndicatorValidationError as error:
        return _error_response(error, 422)
    except IndicatorAlreadyExistsError as error:
        return _error_response(error, 409)
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify(
        validate_contract(
            {"message": "指标更新成功", "data": data},
            MessageDataResponse[IndicatorItem],
        )
    )


@indicator_bp.patch("/<indicator_id>/status")
@require_maintainer
def patch_indicator_status(indicator_id):
    payload = request.get_json(silent=True) or {}
    try:
        data = indicator_service.patch_status(indicator_id, payload.get("status"))
    except IndicatorNotFoundError as error:
        return _error_response(error, 404)
    except IndicatorValidationError as error:
        return _error_response(error, 422)
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify(
        validate_contract(
            {"message": "指标状态更新成功", "data": data},
            MessageDataResponse[IndicatorItem],
        )
    )


@indicator_bp.delete("/<indicator_id>")
@require_maintainer
def delete_indicator(indicator_id):
    try:
        indicator_service.delete_indicator(indicator_id)
    except IndicatorNotFoundError as error:
        return _error_response(error, 404)
    except IndicatorDataSourceError as error:
        return _error_response(error, 500)
    return jsonify({"message": "指标删除成功"})
