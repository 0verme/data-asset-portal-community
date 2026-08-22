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

"""Unified module manifest — single source of truth for repository modules.

Module *codes* match existing frontend menu codes and search/stat module keys
so that this phase does not require a global rename. Availability is open by
default; deployment dependencies and instance menu status are separate
concerns handled by their respective services.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


# Codes used by frontend menus, ModuleContent, portal search scopes, and
# backend portal/search providers. Keep them stable across the API boundary.
MODULES: dict[str, dict[str, Any]] = {
    "portal": {
        "name": "门户首页",
        "frontend_path": "/",
        "backend_blueprints": ["portal"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": False,
        "portal_stat_provider": False,
    },
    "dwm": {
        "name": "数据仓库",
        "frontend_path": "/data-warehouse",
        "backend_blueprints": ["assets"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "upstream": {
        "name": "上游卸数",
        "frontend_path": "/upstream",
        "backend_blueprints": ["upstream"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "mapping": {
        "name": "字段映射",
        "frontend_path": "/field-mapping",
        "backend_blueprints": ["field_mapping"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "lineage": {
        "name": "血缘分析",
        "frontend_path": "/lineage",
        "backend_blueprints": ["lineage"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": False,
        "portal_stat_provider": False,
    },
    "root": {
        "name": "词根管理",
        "frontend_path": "/root-management",
        "backend_blueprints": ["root"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "indicator": {
        "name": "指标维护",
        "frontend_path": "/indicator-maintenance",
        "backend_blueprints": ["indicator", "indicator_path"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "report": {
        "name": "报表资产",
        "frontend_path": "/report-assets",
        "backend_blueprints": ["report"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "apiAsset": {
        "name": "API 资产",
        "frontend_path": "/api-assets",
        "backend_blueprints": ["api_asset"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "push": {
        "name": "下游推送",
        "frontend_path": "/push",
        "backend_blueprints": ["push"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "codeTable": {
        "name": "码值表维护",
        "frontend_path": "/code-table-maintenance",
        "backend_blueprints": ["manual_code_table"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": True,
        "portal_stat_provider": True,
    },
    "system": {
        "name": "系统管理",
        "frontend_path": "/system-management",
        "backend_blueprints": ["system_management", "operation_log"],
        "enabled_by_default": True,
        "requires": [],
        "search_provider": False,
        "portal_stat_provider": False,
    },
}


def list_module_codes() -> list[str]:
    return list(MODULES.keys())


def get_module_manifest(code: str) -> dict[str, Any] | None:
    entry = MODULES.get(code)
    return deepcopy(entry) if entry is not None else None


def iter_modules() -> list[tuple[str, dict[str, Any]]]:
    return [(code, deepcopy(meta)) for code, meta in MODULES.items()]


def validate_manifest() -> None:
    """Raise ValueError if the static manifest is internally inconsistent."""
    codes = set(MODULES)
    seen_blueprint_names: set[str] = set()
    seen_paths: set[str] = set()
    for code, meta in MODULES.items():
        if not code or not str(code).strip():
            raise ValueError("module code must be non-empty")
        path = str(meta.get("frontend_path") or "").strip()
        if path:
            if path in seen_paths:
                raise ValueError(f"duplicate frontend_path registered: {path}")
            seen_paths.add(path)
        for req in meta.get("requires") or []:
            if req not in codes:
                raise ValueError(f"module {code!r} requires unknown module {req!r}")
            if req == code:
                raise ValueError(f"module {code!r} cannot require itself")
        for bp in meta.get("backend_blueprints") or []:
            name = str(bp).strip()
            if not name:
                raise ValueError(f"module {code!r} has empty blueprint name")
            if name in seen_blueprint_names:
                raise ValueError(f"duplicate blueprint registration: {name}")
            seen_blueprint_names.add(name)
