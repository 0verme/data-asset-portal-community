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
from ..services.root_service import (
    RootAlreadyExistsError,
    RootDataSourceError,
    RootNotFoundError,
    RootValidationError,
    root_service,
)


root_bp = Blueprint("roots", __name__)


@root_bp.get("")
def get_roots():
    try:
        items = root_service.get_roots(keyword=request.args.get("keyword"), cat=request.args.get("cat"))
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@root_bp.get("/categories")
def get_root_categories():
    try:
        items = root_service.get_root_categories()
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@root_bp.get("/<abbr>")
def get_root_detail(abbr):
    try:
        data = root_service.get_root_detail(abbr)
    except RootNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"data": data})


@root_bp.post("")
@require_maintainer
def create_root():
    try:
        data = root_service.create_root(request.get_json(silent=True))
    except RootValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except RootAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "词根创建成功", "data": data}), 201


@root_bp.put("/<abbr>")
@require_maintainer
def update_root(abbr):
    try:
        data = root_service.update_root(abbr, request.get_json(silent=True))
    except RootNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except RootValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except RootAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "词根更新成功", "data": data})


@root_bp.delete("/<abbr>")
@require_maintainer
def delete_root(abbr):
    try:
        root_service.delete_root(abbr)
    except RootNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "词根删除成功"})


@root_bp.post("/import")
@require_maintainer
def import_root_items():
    try:
        data = root_service.import_roots(request.get_json(silent=True))
    except RootValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except RootAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except RootDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "词根导入成功", "data": data})
