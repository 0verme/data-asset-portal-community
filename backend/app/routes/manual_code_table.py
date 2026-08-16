# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

import csv
import io

from flask import Blueprint, Response, jsonify, request

from ..auth import require_maintainer
from ..services.manual_code_table_service import (
    ManualCodeTableAlreadyExistsError,
    ManualCodeTableDataSourceError,
    ManualCodeTableNotFoundError,
    ManualCodeTableValidationError,
    manual_code_table_service,
)


manual_code_table_bp = Blueprint("manual_code_tables", __name__)
STYLE_LABELS = {"enum": "标准枚举", "dim": "维度字典", "status": "状态流转", "map": "业务映射", "custom": "自定义结构"}
STATUS_LABELS = {"active": "启用", "draft": "草稿", "disabled": "停用"}


def _error_response(error):
    if isinstance(error, ManualCodeTableNotFoundError):
        return jsonify({"error": error.to_dict()}), 404
    if isinstance(error, ManualCodeTableAlreadyExistsError):
        return jsonify({"error": error.to_dict()}), 409
    if isinstance(error, ManualCodeTableValidationError):
        return jsonify({"error": error.to_dict()}), 422
    return jsonify({"error": error.to_dict()}), 500


@manual_code_table_bp.get("")
def list_manual_code_tables():
    try:
        items = manual_code_table_service.get_tables(
            keyword=request.args.get("keyword"),
            style=request.args.get("style"),
            status=request.args.get("status"),
        )
    except (ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
        return _error_response(error)
    return jsonify({"items": items})


@manual_code_table_bp.get("/export")
def export_manual_code_tables():
    try:
        items = manual_code_table_service.get_tables(
            keyword=request.args.get("keyword"),
            style=request.args.get("style"),
            status=request.args.get("status"),
        )
    except (ManualCodeTableValidationError, ManualCodeTableDataSourceError) as error:
        return _error_response(error)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["表编码", "表名称", "表样式", "负责人", "状态", "说明", "更新时间"])
    for item in items:
        writer.writerow([
            item["tableCode"],
            item["tableName"],
            STYLE_LABELS.get(item["style"], item["style"]),
            item["owner"],
            STATUS_LABELS.get(item["status"], item["status"]),
            item["remark"],
            item["updatedAt"],
        ])
    return Response(
        "\ufeff" + output.getvalue(),
        content_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=manual-code-tables.csv"},
    )


@manual_code_table_bp.get("/<table_id>")
def get_manual_code_table(table_id):
    try:
        data = manual_code_table_service.get_table(table_id)
    except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
        return _error_response(error)
    return jsonify({"data": data})


@manual_code_table_bp.post("")
@require_maintainer
def create_manual_code_table():
    try:
        data = manual_code_table_service.create_table(request.get_json(silent=True))
    except (
        ManualCodeTableAlreadyExistsError,
        ManualCodeTableValidationError,
        ManualCodeTableDataSourceError,
    ) as error:
        return _error_response(error)
    return jsonify({"message": "Manual code table created", "data": data}), 201


@manual_code_table_bp.put("/<table_id>")
@require_maintainer
def update_manual_code_table(table_id):
    try:
        data = manual_code_table_service.update_table(table_id, request.get_json(silent=True))
    except (
        ManualCodeTableNotFoundError,
        ManualCodeTableAlreadyExistsError,
        ManualCodeTableValidationError,
        ManualCodeTableDataSourceError,
    ) as error:
        return _error_response(error)
    return jsonify({"message": "Manual code table updated", "data": data})


@manual_code_table_bp.patch("/<table_id>/status")
@require_maintainer
def patch_manual_code_table_status(table_id):
    payload = request.get_json(silent=True) or {}
    try:
        data = manual_code_table_service.update_status(table_id, payload.get("status"))
    except (
        ManualCodeTableNotFoundError,
        ManualCodeTableValidationError,
        ManualCodeTableDataSourceError,
    ) as error:
        return _error_response(error)
    return jsonify({"message": "Manual code table status updated", "data": data})


@manual_code_table_bp.delete("/<table_id>")
@require_maintainer
def delete_manual_code_table(table_id):
    try:
        manual_code_table_service.delete_table(table_id)
    except (ManualCodeTableNotFoundError, ManualCodeTableDataSourceError) as error:
        return _error_response(error)
    return "", 204
