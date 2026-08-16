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

from ..services.field_mapping_service import FieldMappingDataSourceError, field_mapping_service


field_mapping_bp = Blueprint("field_mappings", __name__)


def _build_params():
    return {
        "keyword": request.args.get("keyword"),
        "upstreamSystemId": (
            request.args.get("dataSourceId")
            or request.args.get("upstreamSystemId")
            or request.args.get("sourceSystemId")
        ),
        "srcSystem": request.args.get("srcSystem"),
        "srcTable": request.args.get("srcTable"),
        "srcField": request.args.get("srcField"),
        "emptyComment": request.args.get("emptyComment"),
        "targetTable": request.args.get("targetTable"),
        "targetField": request.args.get("targetField"),
        "page": request.args.get("page"),
        "pageSize": request.args.get("pageSize") or request.args.get("limit"),
        "sortKey": request.args.get("sortKey"),
        "sortDirection": request.args.get("sortDirection"),
    }


@field_mapping_bp.get("/source-systems")
def get_source_systems():
    try:
        items = field_mapping_service.get_source_systems()
    except FieldMappingDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@field_mapping_bp.get("/stats")
def get_mapping_stats():
    try:
        data = field_mapping_service.get_stats(_build_params())
    except FieldMappingDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@field_mapping_bp.get("/fields")
def get_field_mappings():
    try:
        data = field_mapping_service.get_field_mappings(_build_params())
    except FieldMappingDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(data)


@field_mapping_bp.get("/tables")
def get_table_mappings():
    try:
        data = field_mapping_service.get_table_mappings(_build_params())
    except FieldMappingDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(data)
