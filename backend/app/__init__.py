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

import time
from datetime import timedelta
import logging

from flask import Flask, g, jsonify
from flask_cors import CORS

from .logging_config import configure_logging
from .settings import get_auth_session_days, get_flask_runtime_config
from .services.operation_log_service import REQUEST_START_KEY


def create_app(*, capabilities=None):
    """Application factory.

    *capabilities* may be an already-resolved capability map (used by tests).
    When omitted, capabilities are resolved from environment variables.
    """
    from .core.blueprint_registry import register_enabled_blueprints
    from .core.profiles import apply_runtime_profile
    from .core.capabilities import (
        ModuleCapabilityError,
        resolve_capabilities,
        set_resolved_capabilities,
    )
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
    def _start_request_timer():
        setattr(g, REQUEST_START_KEY, time.perf_counter())

    cors_origins = app.config["CORS_ORIGINS"]
    if cors_origins:
        CORS(
            app,
            resources={r"/api/*": {"origins": cors_origins}},
            supports_credentials=True,
        )

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
