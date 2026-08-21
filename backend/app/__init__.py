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

import logging
import time
from datetime import timedelta

from flask import Flask, g, jsonify, request  # pyright: ignore[reportMissingImports]
from flask_cors import CORS
from werkzeug.exceptions import HTTPException  # pyright: ignore[reportMissingImports]

from .application import (
    RequestContext,
    reset_request_context,
    resolve_client_address,
    set_request_context,
)
from .auth import get_session_identity
from .logging_config import configure_logging
from .settings import (
    get_auth_session_days,
    get_flask_runtime_config,
    get_trust_proxy_headers,
)

_REQUEST_CONTEXT_TOKEN_KEY = "_request_context_token"


# Stable, non-leaking client-facing copy for framework-level HTTP errors that
# would otherwise return Flask's default English HTML pages.
_HTTP_ERROR_COPY = {
    400: "请求参数不合法",
    401: "未授权，请先登录",
    403: "无权限执行此操作",
    404: "请求的资源不存在",
    405: "请求方法不被允许",
    413: "请求体过大",
    415: "不支持的媒体类型",
    429: "请求过于频繁，请稍后再试",
}


def create_app(*, capabilities=None):
    """Application factory.

    *capabilities* may be an already-resolved capability map (used by tests).
    When omitted, capabilities are resolved from environment variables.
    """
    from .core.blueprint_registry import register_enabled_blueprints
    from .core.capabilities import (
        ModuleCapabilityError,
        resolve_capabilities,
        set_resolved_capabilities,
    )
    from .core.profiles import apply_runtime_profile
    from .services.lineage import log_lineage_storage_status

    runtime_profile = apply_runtime_profile()
    configure_logging()
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    app.config.update(get_flask_runtime_config())
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=get_auth_session_days())

    app.logger.setLevel(logging.getLogger().level)
    app.logger.info("Flask app created")

    try:
        resolved = capabilities if capabilities is not None else resolve_capabilities()
    except ModuleCapabilityError:
        raise
    set_resolved_capabilities(resolved)
    enabled_codes = list(resolved.get("enabled_codes") or [])
    disabled_codes = [
        item["code"] for item in resolved.get("modules") or [] if not item.get("enabled")
    ]
    edition = resolved.get("edition") or "private"
    from .db.registry import available_adapter_names
    app.logger.info("Edition: %s", edition)
    app.logger.info("Enabled modules: %s", ",".join(enabled_codes))
    app.logger.info("Disabled modules: %s", ",".join(disabled_codes))
    app.logger.info("Database adapters: %s", ",".join(available_adapter_names(edition)))
    app.logger.info("Private collectors loaded: false")
    app.logger.info("Enterprise connectors loaded: false")
    app.extensions["runtime_profile"] = runtime_profile

    # Only probe lineage storage when the lineage module is enabled.
    if "lineage" in set(resolved.get("enabled_codes") or []):
        log_lineage_storage_status()

    register_enabled_blueprints(app, resolved)

    @app.before_request
    def _set_request_context():
        context = RequestContext(
            identity=get_session_identity(),
            request_id=request.headers.get("X-Request-ID"),
            method=request.method or "",
            path=request.path or "",
            client_address=resolve_client_address(
                request.remote_addr,
                request.headers,
                trust_proxy_headers=get_trust_proxy_headers(),
            ),
            user_agent=request.headers.get("User-Agent", ""),
            started_at=time.perf_counter(),
        )
        setattr(g, _REQUEST_CONTEXT_TOKEN_KEY, set_request_context(context))

    @app.teardown_request
    def _reset_request_context(_error):
        token = getattr(g, _REQUEST_CONTEXT_TOKEN_KEY, None)
        if token is not None:
            reset_request_context(token)
            delattr(g, _REQUEST_CONTEXT_TOKEN_KEY)

    cors_origins = app.config["CORS_ORIGINS"]
    if cors_origins:
        CORS(
            app,
            resources={r"/api/*": {"origins": cors_origins}},
            supports_credentials=True,
        )

    @app.after_request
    def _apply_security_headers(response):
        for header, value in app.config.get("SECURITY_HEADERS", {}).items():
            response.headers.setdefault(header, value)
        return response

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        code = error.code if isinstance(error.code, int) else 500
        message = _HTTP_ERROR_COPY.get(code, str(error.description or "").strip() or "请求失败")
        return jsonify({"error": {"code": f"HTTP_{code}", "message": message}}), code

    @app.errorhandler(404)
    def handle_not_found(_error):
        return (
            jsonify(
                {
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "请求的资源不存在",
                    }
                }
            ),
            404,
        )

    @app.errorhandler(500)
    def handle_internal_error(error):
        app.logger.exception("Unhandled internal server error", exc_info=error)
        return (
            jsonify(
                {
                    "error": {
                        "code": "INTERNAL_SERVER_ERROR",
                        "message": "服务端发生未预期异常",
                    }
                }
            ),
            500,
        )

    return app
