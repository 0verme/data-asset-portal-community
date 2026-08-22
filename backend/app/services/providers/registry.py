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

"""Pluggable portal search / stat provider registry.

Modules contribute configs via register_* helpers. KeywordSearchProvider and
PortalService only consume the registry and apply instance menu visibility and
error degradation — they do not hard-code per-module SQL.
"""

from __future__ import annotations

from typing import Any, Callable


_search_entities: list[dict[str, Any]] = []
_portal_stats: list[dict[str, Any]] = []
_search_types: set[str] = set()
_stat_keys: set[str] = set()


def register_search_entity(config: dict[str, Any]) -> dict[str, Any]:
    """Register one unified-search entity config (SQL + build_item)."""
    entity_type = str(config.get("type") or "").strip()
    module = str(config.get("module") or "").strip()
    label = str(config.get("label") or "").strip()
    build_item = config.get("build_item")
    if not entity_type:
        raise ValueError("search entity requires non-empty type")
    if not module:
        raise ValueError(f"search entity {entity_type!r} requires module")
    if not label:
        raise ValueError(f"search entity {entity_type!r} requires label")
    if entity_type in _search_types:
        raise ValueError(f"duplicate search entity type: {entity_type}")
    if not callable(build_item):
        raise ValueError(f"search entity {entity_type!r} requires callable build_item")
    for required in ("from", "matchers", "select", "order"):
        if required not in config:
            raise ValueError(f"search entity {entity_type!r} missing {required}")
    _search_types.add(entity_type)
    _search_entities.append(config)
    return config


def register_portal_stat(config: dict[str, Any]) -> dict[str, Any]:
    """Register one portal homepage stat card config."""
    key = str(config.get("key") or "").strip()
    module = str(config.get("module") or "").strip()
    label = str(config.get("label") or "").strip()
    if not key:
        raise ValueError("portal stat requires non-empty key")
    if not module:
        raise ValueError(f"portal stat {key!r} requires module")
    if not label:
        raise ValueError(f"portal stat {key!r} requires label")
    if key in _stat_keys:
        raise ValueError(f"duplicate portal stat key: {key}")
    if not config.get("from"):
        raise ValueError(f"portal stat {key!r} requires from")
    _stat_keys.add(key)
    _portal_stats.append(config)
    return config


def list_search_entities() -> list[dict[str, Any]]:
    return list(_search_entities)


def list_portal_stats() -> list[dict[str, Any]]:
    return list(_portal_stats)


def entity_module_codes() -> dict[str, str]:
    """Map search entity type → module code."""
    return {
        str(item["type"]): str(item["module"])
        for item in _search_entities
    }


def module_scope_aliases() -> dict[str, str]:
    """Map module code → primary search entity type (for scope=module query)."""
    aliases: dict[str, str] = {}
    for item in _search_entities:
        module = str(item["module"])
        entity_type = str(item["type"])
        # First registered entity wins when a module contributes multiple types.
        aliases.setdefault(module, entity_type)
    return aliases


def reset_registries() -> None:
    """Test helper — clear registrations (builtins must be re-imported after)."""
    _search_entities.clear()
    _portal_stats.clear()
    _search_types.clear()
    _stat_keys.clear()


# Type alias for build_item callables (documentation only).
BuildItemFn = Callable[[dict[str, Any], list[dict[str, str]]], dict[str, Any]]
