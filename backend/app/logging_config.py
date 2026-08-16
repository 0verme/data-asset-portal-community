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

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .settings import LOGS_DIR, get_int_env, get_string_env


BACKEND_LOG_DIR = LOGS_DIR / "backend"
BACKEND_LOG_FILE = BACKEND_LOG_DIR / "app.log"
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_CONFIGURED = False


def _build_file_handler() -> RotatingFileHandler:
    handler = RotatingFileHandler(
        BACKEND_LOG_FILE,
        maxBytes=get_int_env("APP_LOG_MAX_BYTES", 2 * 1024 * 1024, minimum=1),
        backupCount=get_int_env("APP_LOG_BACKUP_COUNT", 5, minimum=0),
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    return handler


def _build_stream_handler() -> logging.StreamHandler:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    return handler


def configure_logging() -> Path:
    global _CONFIGURED

    BACKEND_LOG_DIR.mkdir(parents=True, exist_ok=True)

    if _CONFIGURED:
        return BACKEND_LOG_FILE

    root_logger = logging.getLogger()
    log_level_name = get_string_env("APP_LOG_LEVEL", "INFO").upper()
    root_logger.setLevel(getattr(logging, log_level_name, logging.INFO))

    if not any(getattr(handler, "_asset_portal_handler", False) for handler in root_logger.handlers):
        for handler in (_build_file_handler(), _build_stream_handler()):
            handler._asset_portal_handler = True
            root_logger.addHandler(handler)

    for logger_name in ("werkzeug", "app"):
        logger = logging.getLogger(logger_name)
        logger.setLevel(root_logger.level)
        logger.propagate = True

    _CONFIGURED = True
    logging.getLogger(__name__).info("Backend logging initialized at %s", BACKEND_LOG_FILE)
    return BACKEND_LOG_FILE
