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

"""Module-aware Flask blueprint registration.

Common infrastructure blueprints are always registered. Optional business
module blueprints are registered only when the corresponding capability is
enabled.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from flask import Flask

from .modules import MODULES


LOGGER = logging.getLogger(__name__)


def _load_common() -> list[tuple[Any, str]]:
    from ..routes.auth import auth_bp
    from ..routes.capabilities import capabilities_bp
    from ..routes.common_code import common_code_bp
    from ..routes.portal import portal_bp
    from ..routes.search import search_bp

    return [
        (auth_bp, "/api/auth"),
        (capabilities_bp, "/api/capabilities"),
        (common_code_bp, "/api/common-codes"),
        (portal_bp, "/api/portal"),
        (search_bp, "/api/search"),
    ]


def _build_module_loaders() -> dict[str, tuple[Callable[[], Any], str]]:
    def assets():
        from ..routes.assets import assets_bp
        return assets_bp

    def field_mapping():
        from ..routes.field_mapping import field_mapping_bp
        return field_mapping_bp

    def indicator():
        from ..routes.indicator import indicator_bp
        return indicator_bp

    def indicator_path():
        from ..routes.indicator_path import indicator_path_bp
        return indicator_path_bp

    def lineage():
        from ..routes.lineage import lineage_bp
        return lineage_bp

    def manual_code_table():
        from ..routes.manual_code_table import manual_code_table_bp
        return manual_code_table_bp

    def api_asset():
        from ..routes.api_asset import api_asset_bp
        return api_asset_bp

    def push():
        from ..routes.push import push_bp
        return push_bp

    def report():
        from ..routes.report import report_bp
        return report_bp

    def root():
        from ..routes.root import root_bp
        return root_bp

    def system_management():
        from ..routes.system_management import system_management_bp
        return system_management_bp

    def operation_log():
        from ..routes.operation_log import operation_log_bp
        return operation_log_bp

    def upstream():
        from ..routes.upstream import upstream_bp
        return upstream_bp

    return {
        "assets": (assets, "/api/assets"),
        "field_mapping": (field_mapping, "/api/field-mappings"),
        "indicator": (indicator, "/api/indicators"),
        "indicator_path": (indicator_path, "/api/indicator-path"),
        "lineage": (lineage, "/api/lineage"),
        "manual_code_table": (manual_code_table, "/api/manual-code-tables"),
        "api_asset": (api_asset, "/api/api-assets"),
        "push": (push, "/api/push"),
        "report": (report, "/api/reports"),
        "root": (root, "/api/roots"),
        "system_management": (system_management, "/api/system"),
        "operation_log": (operation_log, "/api/operation-logs"),
        "upstream": (upstream, "/api/upstreams"),
    }


def validate_blueprint_registry(
    module_loaders: dict[str, tuple[Callable[[], Any], str]] | None = None,
) -> None:
    """Ensure each blueprint name maps to a unique URL prefix among module BPs."""
    loaders = module_loaders if module_loaders is not None else _build_module_loaders()
    prefix_owners: dict[str, str] = {}
    for code, meta in MODULES.items():
        for bp_name in meta.get("backend_blueprints") or []:
            if bp_name == "portal":
                # Registered as common infrastructure.
                continue
            if bp_name not in loaders:
                raise ValueError(
                    f"module {code!r} references unregistered blueprint {bp_name!r}"
                )
            _loader, prefix = loaders[bp_name]
            owner = prefix_owners.get(prefix)
            if owner and owner != bp_name:
                raise ValueError(
                    f"URL prefix {prefix!r} registered by both {owner!r} and {bp_name!r}"
                )
            prefix_owners[prefix] = bp_name


def register_enabled_blueprints(app: Flask, capabilities: dict[str, Any]) -> list[str]:
    """Register common + enabled-module blueprints. Returns registered prefixes."""
    validate_blueprint_registry()
    registered: list[str] = []
    seen_prefixes: set[str] = set()

    def _register(bp, prefix: str) -> None:
        if prefix in seen_prefixes:
            return
        app.register_blueprint(bp, url_prefix=prefix)
        seen_prefixes.add(prefix)
        registered.append(prefix)

    for bp, prefix in _load_common():
        _register(bp, prefix)

    enabled = set(capabilities.get("enabled_codes") or [])
    loaders = _build_module_loaders()

    for code, meta in MODULES.items():
        if code not in enabled:
            LOGGER.info("skip blueprints for disabled module code=%s", code)
            continue
        for bp_name in meta.get("backend_blueprints") or []:
            if bp_name == "portal":
                continue  # already common
            entry = loaders.get(bp_name)
            if entry is None:
                raise ValueError(f"no loader for blueprint {bp_name!r}")
            loader, prefix = entry
            bp = loader()
            if bp is None:
                continue
            _register(bp, prefix)
            LOGGER.info(
                "registered blueprint module=%s name=%s prefix=%s",
                code,
                bp_name,
                prefix,
            )

    if not hasattr(app, "extensions") or app.extensions is None:
        app.extensions = {}
    app.extensions["module_capabilities"] = capabilities
    app.extensions["registered_api_prefixes"] = list(registered)
    return registered
