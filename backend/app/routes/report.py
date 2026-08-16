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
from ..services.report_service import (
    ReportAlreadyExistsError,
    ReportDataSourceError,
    ReportNotFoundError,
    ReportValidationError,
    report_service,
)


report_bp = Blueprint("reports", __name__)


@report_bp.get("")
def get_reports():
    try:
        items = report_service.get_reports(
            keyword=request.args.get("keyword"),
            report_type=request.args.get("type"),
            domain=request.args.get("domain"),
            status=request.args.get("status"),
            owner_dept=request.args.get("ownerDept"),
        )
    except ReportDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@report_bp.get("/<report_code>")
def get_report_detail(report_code):
    try:
        data = report_service.get_report_detail(report_code)
    except ReportNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except ReportDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@report_bp.post("")
@require_maintainer
def create_report():
    try:
        data = report_service.create_report(request.get_json(silent=True))
    except ReportValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except ReportAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except ReportDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "报表创建成功", "data": data}), 201


@report_bp.put("/<report_code>")
@require_maintainer
def update_report(report_code):
    try:
        data = report_service.update_report(report_code, request.get_json(silent=True))
    except ReportNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except ReportValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except ReportAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except ReportDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "报表更新成功", "data": data})


@report_bp.delete("/<report_code>")
@require_maintainer
def delete_report(report_code):
    try:
        report_service.delete_report(report_code)
    except ReportNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except ReportDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "报表删除成功"})
