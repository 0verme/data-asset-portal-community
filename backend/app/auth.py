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

from flask import jsonify, session  # pyright: ignore[reportMissingImports]

from .application import (
    ADMIN_ROLE,
    MAINTENANCE_ROLES,
    SESSION_PAYLOAD_KEY,
    RequestContext,
    identity_for_session,
    identity_from_mapping,
    set_current_request_identity,
)
from .application.errors import ApplicationError

SESSION_KEY = SESSION_PAYLOAD_KEY


def get_session_identity():
    """Adapt the Flask session into the framework-neutral identity boundary."""
    return identity_from_mapping(session.get(SESSION_KEY))


def get_session_user() -> dict | None:
    identity = get_session_identity()
    return identity.as_dict() if identity else None


def set_session_user(user: dict, remember: bool = False):
    identity = identity_for_session(user)
    session[SESSION_KEY] = identity.as_dict()
    session.permanent = bool(remember)
    set_current_request_identity(identity)


def clear_session_user():
    session.pop(SESSION_KEY, None)
    session.permanent = False
    set_current_request_identity(None)


def require_admin(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        context = RequestContext(identity=get_session_identity())
        try:
            identity = context.require_authenticated()
        except ApplicationError:
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
        if identity.role != ADMIN_ROLE:
            return jsonify({"error": {"code": "FORBIDDEN", "message": "仅系统管理员可执行此操作。"}}), 403
        return view_func(*args, **kwargs)

    return wrapped


def require_maintainer(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        context = RequestContext(identity=get_session_identity())
        try:
            identity = context.require_authenticated()
        except ApplicationError:
            return jsonify({"error": {"code": "UNAUTHORIZED", "message": "请先登录。"}}), 401
        if identity.role not in MAINTENANCE_ROLES:
            return jsonify({"error": {"code": "UNAUTHORIZED", "message": "请先登录。"}}), 401
        return view_func(*args, **kwargs)

    return wrapped
