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

from ..services.common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    CommonCodeValidationError,
    common_code_service,
)


common_code_bp = Blueprint("common_codes", __name__)


@common_code_bp.get("/categories")
def get_common_code_categories():
    try:
        items = common_code_service.get_categories()
    except CommonCodeDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@common_code_bp.get("/categories/<category_code>/items")
def get_common_code_items(category_code):
    try:
        items = common_code_service.get_items(category_code)
    except CommonCodeCategoryNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except CommonCodeDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@common_code_bp.get("/items")
def get_common_code_items_batch():
    try:
        data = common_code_service.get_items_batch((request.args.get("codes") or "").split(","))
    except CommonCodeValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except CommonCodeDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(data)
