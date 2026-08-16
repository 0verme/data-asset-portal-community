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

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..auth import clear_session_user, get_session_user, set_session_user
from ..services.auth_service import AuthError, auth_service
from ..services.operation_log_service import (
    OPERATION_TYPE_LOGIN,
    OPERATION_TYPE_LOGOUT,
    operation_log_service,
)


auth_bp = Blueprint("auth", __name__)

MODULE_LOGIN = "系统登录"


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    try:
        user = auth_service.authenticate(payload.get("username"), payload.get("password"))
    except AuthError as error:
        operation_log_service.record_best_effort_audit(
            module_name=MODULE_LOGIN,
            operation_type=OPERATION_TYPE_LOGIN,
            operation_object=username,
            operation_desc="管理员登录失败",
            result_status="failure",
            error_message=error.message,
            user_id=username,
            user_name=username,
        )
        return jsonify({"error": error.to_dict()}), error.status_code

    set_session_user(user, bool(payload.get("remember")))
    operation_log_service.record_best_effort_audit(
        module_name=MODULE_LOGIN,
        operation_type=OPERATION_TYPE_LOGIN,
        operation_object=user.get("user") or username,
        operation_desc="管理员登录系统",
    )
    return jsonify({"message": "登录成功", "data": user})


@auth_bp.get("/me")
def me():
    user = get_session_user()
    if not user:
        return jsonify({"error": {"code": "UNAUTHORIZED", "message": "当前未登录。"}}), 401
    return jsonify({"data": user})


@auth_bp.post("/logout")
def logout():
    current = get_session_user()
    clear_session_user()
    if current:
        operation_log_service.record_best_effort_audit(
            module_name=MODULE_LOGIN,
            operation_type=OPERATION_TYPE_LOGOUT,
            operation_object=current.get("user") or "",
            operation_desc="管理员退出登录",
            user_id=current.get("user") or "",
            user_name=current.get("name") or current.get("user") or "",
        )
    return jsonify({"message": "已退出登录"})
