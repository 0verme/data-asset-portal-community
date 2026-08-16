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
from ..services.assets_service import (
    AssetAlreadyExistsError,
    AssetDataSourceError,
    AssetNotFoundError,
    AssetValidationError,
    assets_service,
)


assets_bp = Blueprint("assets", __name__)


@assets_bp.get("/tables")
def get_asset_tables():
    layer = request.args.get("layer")
    domain = request.args.get("domain")
    keyword = request.args.get("keyword") or request.args.get("q")
    schema = request.args.get("schema")
    owner = request.args.get("owner")
    page = request.args.get("page")
    page_size = request.args.get("pageSize") or request.args.get("limit")
    order_by = request.args.get("orderBy") or request.args.get("sort")
    try:
        if str(request.args.get("summary") or "").strip().lower() in {"1", "true", "yes"}:
            payload = assets_service.get_asset_table_page(
                layer=layer,
                domain=domain,
                keyword=keyword,
                schema=schema,
                owner=owner,
                page=page,
                page_size=page_size,
                order_by=order_by,
            )
        else:
            payload = {
                "items": assets_service.get_asset_tables(
                    layer=layer,
                    domain=domain,
                    keyword=keyword,
                    schema=schema,
                    owner=owner,
                    page=page,
                    page_size=page_size,
                    order_by=order_by,
                )
            }
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(payload)


@assets_bp.get("/tables/<table_name>")
def get_asset_detail(table_name):
    try:
        data = assets_service.get_asset_detail(table_name)
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@assets_bp.get("/tables/<table_name>/fields")
def get_asset_fields(table_name):
    try:
        items = assets_service.get_asset_fields(table_name)
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@assets_bp.get("/tables/<table_name>/ddl")
def get_asset_ddl(table_name):
    try:
        data = assets_service.get_asset_ddl(table_name)
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@assets_bp.get("/domains")
def get_domains():
    try:
        items = assets_service.get_domains(layer=request.args.get("layer"))
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@assets_bp.get("/layers")
def get_layers():
    try:
        items = assets_service.get_layers(domain=request.args.get("domain"))
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@assets_bp.post("/tables")
@require_maintainer
def create_asset_table():
    try:
        data = assets_service.create_asset_table(request.get_json(silent=True))
    except AssetValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except AssetAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "数据表创建成功", "data": data}), 201


@assets_bp.put("/tables/<table_name>")
@require_maintainer
def update_asset_table(table_name):
    try:
        data = assets_service.update_asset_table(table_name, request.get_json(silent=True))
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except AssetAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "数据表更新成功", "data": data})


@assets_bp.put("/tables/<table_name>/fields")
@require_maintainer
def update_asset_fields(table_name):
    try:
        data = assets_service.update_asset_fields(table_name, request.get_json(silent=True))
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "字段列表更新成功", "data": data})


@assets_bp.delete("/tables/<table_name>")
@require_maintainer
def delete_asset_table(table_name):
    try:
        assets_service.delete_asset_table(table_name)
    except AssetNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except AssetDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "数据表删除成功"})
