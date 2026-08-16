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
from ..services.push_service import (
    PushDataSourceError,
    PushJobAlreadyExistsError,
    PushJobNotFoundError,
    PushSystemAlreadyExistsError,
    PushSystemInUseError,
    PushSystemNotFoundError,
    PushValidationError,
    push_service,
)


push_bp = Blueprint("push", __name__)


@push_bp.get("/systems")
def get_push_systems():
    try:
        items = push_service.get_push_systems(
            status=request.args.get("status"),
            protocol=request.args.get("protocol"),
            dept=request.args.get("dept"),
            keyword=request.args.get("keyword"),
            page=request.args.get("page"),
            page_size=request.args.get("pageSize") or request.args.get("limit"),
        )
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@push_bp.get("/systems/<system_id>")
def get_push_system_detail(system_id):
    try:
        data = push_service.get_push_system_detail(system_id)
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@push_bp.get("/systems/<system_id>/admin-detail")
@require_maintainer
def get_push_system_admin_detail(system_id):
    try:
        data = push_service.get_push_system_admin_detail(system_id)
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@push_bp.post("/systems")
@require_maintainer
def create_push_system():
    try:
        data = push_service.create_push_system(request.get_json(silent=True))
    except PushValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except PushSystemAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "下游系统创建成功", "data": data}), 201


@push_bp.put("/systems/<system_id>")
@require_maintainer
def update_push_system(system_id):
    try:
        data = push_service.update_push_system(system_id, request.get_json(silent=True))
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except PushSystemAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "下游系统更新成功", "data": data})


@push_bp.delete("/systems/<system_id>")
@require_maintainer
def delete_push_system(system_id):
    try:
        push_service.delete_push_system(system_id)
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushSystemInUseError as error:
        return jsonify({"error": error.to_dict()}), 409
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "下游系统删除成功"})


@push_bp.post("/systems/<system_id>/jobs")
@require_maintainer
def create_push_job(system_id):
    try:
        data = push_service.create_push_job(system_id, request.get_json(silent=True))
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except PushJobAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "推送作业创建成功", "data": data}), 201


@push_bp.put("/systems/<system_id>/jobs/<job_id>")
@require_maintainer
def update_push_job(system_id, job_id):
    try:
        data = push_service.update_push_job(system_id, job_id, request.get_json(silent=True))
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushJobNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except PushJobAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "推送作业更新成功", "data": data})


@push_bp.delete("/systems/<system_id>/jobs/<job_id>")
@require_maintainer
def delete_push_job(system_id, job_id):
    try:
        push_service.delete_push_job(system_id, job_id)
    except PushSystemNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushJobNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except PushDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "推送作业删除成功"})
