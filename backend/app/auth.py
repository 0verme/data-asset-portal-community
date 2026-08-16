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

from functools import wraps

from flask import jsonify, session


SESSION_KEY = "dap_auth_user"
ADMIN_ROLE = "admin"
MAINTAINER_ROLE = "maintainer"
MAINTENANCE_ROLES = {ADMIN_ROLE, MAINTAINER_ROLE}


def get_session_user() -> dict | None:
    raw = session.get(SESSION_KEY)
    if not isinstance(raw, dict):
        return None
    if raw.get("role") not in MAINTENANCE_ROLES:
        return None
    return {
        "role": raw["role"],
        "user": raw.get("user") or None,
        "name": raw.get("name") or raw.get("user") or None,
    }


def set_session_user(user: dict, remember: bool = False):
    session[SESSION_KEY] = {
        "role": user.get("role") if user.get("role") in MAINTENANCE_ROLES else ADMIN_ROLE,
        "user": user.get("user"),
        "name": user.get("name") or user.get("user"),
    }
    session.permanent = bool(remember)


def clear_session_user():
    session.pop(SESSION_KEY, None)
    session.permanent = False


def require_admin(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        user = get_session_user()
        if not user:
            return (
                jsonify(
                    {
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": "请先登录管理员账号。",
                        }
                    }
                ),
                401,
            )
        if user["role"] != ADMIN_ROLE:
            return jsonify({"error": {"code": "FORBIDDEN", "message": "仅系统管理员可执行此操作。"}}), 403
        return view_func(*args, **kwargs)

    return wrapped


def require_maintainer(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        user = get_session_user()
        if not user:
            return jsonify({"error": {"code": "UNAUTHORIZED", "message": "请先登录。"}}), 401
        return view_func(*args, **kwargs)

    return wrapped
