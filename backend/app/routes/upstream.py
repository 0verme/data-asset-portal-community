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
from ..services.upstream_service import (
    UpstreamDataSourceError,
    UpstreamSystemAlreadyExistsError,
    UpstreamSystemNotFoundError,
    UpstreamValidationError,
    upstream_service,
)


upstream_bp = Blueprint("upstreams", __name__)


@upstream_bp.get("/systems")
def get_upstream_systems():
    try:
        items = upstream_service.get_systems(
            keyword=request.args.get("keyword"),
            status=request.args.get("status"),
            db_type=request.args.get("dbType"),
            page=request.args.get("page"),
            page_size=request.args.get("pageSize") or request.args.get("limit"),
        )
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@upstream_bp.get("/systems/<system_id>")
def get_upstream_system_detail(system_id):
    try:
        data = upstream_service.get_system_detail(system_id)
    except UpstreamSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@upstream_bp.get("/systems/<system_id>/admin-detail")
@require_maintainer
def get_upstream_system_admin_detail(system_id):
    try:
        data = upstream_service.get_system_admin_detail(system_id)
    except UpstreamSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@upstream_bp.post("/systems")
@require_maintainer
def create_upstream_system():
    try:
        data = upstream_service.create_system(request.get_json(silent=True))
    except UpstreamValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except UpstreamSystemAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "上游系统创建成功", "data": data}), 201


@upstream_bp.put("/systems/<system_id>")
@require_maintainer
def update_upstream_system(system_id):
    try:
        data = upstream_service.update_system(system_id, request.get_json(silent=True))
    except UpstreamSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except UpstreamValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except UpstreamSystemAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "上游系统更新成功", "data": data})


@upstream_bp.patch("/systems/<system_id>/status")
@require_maintainer
def patch_upstream_system_status(system_id):
    payload = request.get_json(silent=True) or {}
    try:
        data = upstream_service.patch_status(system_id, payload.get("status"))
    except UpstreamSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except UpstreamValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "上游系统状态更新成功", "data": data})


@upstream_bp.delete("/systems/<system_id>")
@require_maintainer
def delete_upstream_system(system_id):
    try:
        upstream_service.delete_system(system_id)
    except UpstreamSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except UpstreamDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "上游系统删除成功"})
