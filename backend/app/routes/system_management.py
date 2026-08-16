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

from ..auth import get_session_user, require_admin
from ..services.system_management_service import (
    MenuAlreadyExistsError,
    MenuNotFoundError,
    ParamCategoryNotFoundError,
    ParamDictAlreadyExistsError,
    ParamDictNotFoundError,
    SystemDataSourceError,
    SystemUserAlreadyExistsError,
    SystemUserNotFoundError,
    SystemValidationError,
    system_management_service,
)


system_management_bp = Blueprint("system_management", __name__)


@system_management_bp.get("/users")
@require_admin
def get_users():
    try:
        items = system_management_service.get_users()
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@system_management_bp.post("/users")
@require_admin
def create_user():
    try:
        data = system_management_service.create_user(request.get_json(silent=True))
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemUserAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "User created", "data": data}), 201


@system_management_bp.put("/users/<username>")
@require_admin
def update_user(username):
    try:
        data = system_management_service.update_user(username, request.get_json(silent=True))
    except SystemUserNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemUserAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "User updated", "data": data})


@system_management_bp.patch("/users/<username>/status")
@require_admin
def patch_user_status(username):
    payload = request.get_json(silent=True) or {}
    try:
        data = system_management_service.update_user_status(username, payload.get("status"))
    except SystemUserNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "User status updated", "data": data})


@system_management_bp.post("/users/<username>/reset-password")
@require_admin
def reset_user_password(username):
    try:
        data = system_management_service.reset_user_password(username)
    except SystemUserNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "User reset completed", "data": data})


@system_management_bp.delete("/users/<username>")
@require_admin
def delete_user(username):
    try:
        system_management_service.delete_user(username)
    except SystemUserNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "User deleted"})


@system_management_bp.get("/menus")
def get_menus():
    try:
        items = system_management_service.get_menus()
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    user = get_session_user()
    if not user or user["role"] != "admin":
        items = [
            item
            for item in items
            if item["status"] == "enabled"
            and (
                not item["adminOnly"]
                or (user and user["role"] == "maintainer" and item["code"] == "system")
            )
        ]
    return jsonify({"items": items})


@system_management_bp.post("/menus")
@require_admin
def create_menu():
    try:
        data = system_management_service.create_menu(request.get_json(silent=True))
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except MenuAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Menu created", "data": data}), 201


@system_management_bp.put("/menus/<menu_id>")
@require_admin
def update_menu(menu_id):
    try:
        data = system_management_service.update_menu(menu_id, request.get_json(silent=True))
    except MenuNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except MenuAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Menu updated", "data": data})


@system_management_bp.patch("/menus/<menu_id>/status")
@require_admin
def patch_menu_status(menu_id):
    payload = request.get_json(silent=True) or {}
    try:
        data = system_management_service.update_menu_status(menu_id, payload.get("status"))
    except MenuNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Menu status updated", "data": data})


@system_management_bp.patch("/menus/<menu_id>/move")
@require_admin
def patch_menu_move(menu_id):
    payload = request.get_json(silent=True) or {}
    try:
        items = system_management_service.move_menu(menu_id, payload.get("direction"))
    except MenuNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Menu order updated", "items": items})


@system_management_bp.delete("/menus/<menu_id>")
@require_admin
def delete_menu(menu_id):
    try:
        system_management_service.delete_menu(menu_id)
    except MenuNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Menu deleted"})


@system_management_bp.get("/param-dicts/categories")
@require_admin
def get_param_categories():
    try:
        items = system_management_service.get_param_dict_categories()
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@system_management_bp.patch("/param-dicts/categories/<category_code>/status")
@require_admin
def patch_param_category_status(category_code):
    payload = request.get_json(silent=True) or {}
    try:
        data = system_management_service.update_param_category_status(category_code, payload.get("status"))
    except ParamCategoryNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Category status updated", "data": data})


@system_management_bp.get("/param-dicts")
@require_admin
def get_param_dicts():
    try:
        items = system_management_service.get_param_dicts(request.args.get("categoryCode"))
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"items": items})


@system_management_bp.post("/param-dicts")
@require_admin
def create_param_dict():
    try:
        data = system_management_service.create_param_dict(request.get_json(silent=True))
    except ParamCategoryNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except ParamDictAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Parameter created", "data": data}), 201


@system_management_bp.put("/param-dicts/<dict_id>")
@require_admin
def update_param_dict(dict_id):
    try:
        data = system_management_service.update_param_dict(dict_id, request.get_json(silent=True))
    except ParamCategoryNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except ParamDictNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except ParamDictAlreadyExistsError as error:
        return jsonify({"error": error.to_dict()}), 409
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Parameter updated", "data": data})


@system_management_bp.patch("/param-dicts/<dict_id>/status")
@require_admin
def patch_param_dict_status(dict_id):
    payload = request.get_json(silent=True) or {}
    try:
        data = system_management_service.update_param_dict_status(dict_id, payload.get("status"))
    except ParamDictNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemValidationError as error:
        return jsonify({"error": error.to_dict()}), 422
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Parameter status updated", "data": data})


@system_management_bp.delete("/param-dicts/<dict_id>")
@require_admin
def delete_param_dict(dict_id):
    try:
        system_management_service.delete_param_dict(dict_id)
    except ParamDictNotFoundError as error:
        return jsonify({"error": error.to_dict()}), 404
    except SystemDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify({"message": "Parameter deleted"})
