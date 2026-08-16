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
from ..services.operation_log_service import (
    OperationLogDataSourceError,
    OperationLogNotFoundError,
    OperationLogValidationError,
    operation_log_service,
)


operation_log_bp = Blueprint("operation_log", __name__)


@operation_log_bp.get("")
@require_maintainer
def get_operation_logs():
    filters = {
        "keyword": request.args.get("keyword"),
        "module": request.args.get("module"),
        "operationType": request.args.get("operationType"),
        "result": request.args.get("result"),
        "startTime": request.args.get("startTime"),
        "endTime": request.args.get("endTime"),
        "page": request.args.get("page"),
        "pageSize": request.args.get("pageSize"),
    }
    try:
        result = operation_log_service.get_logs(filters)
    except OperationLogValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except OperationLogDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(result)


@operation_log_bp.get("/<log_id>")
@require_maintainer
def get_operation_log_detail(log_id):
    try:
        data = operation_log_service.get_log_detail(log_id)
    except OperationLogNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except OperationLogDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})
