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

"""Resolve repository module availability.

The repository module manifest is the source of truth for source/runtime
availability. Database providers, external integrations, storage profiles,
and instance menu state are reported by their own contracts and do not change
whether a repository module exists.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .modules import MODULES, list_module_codes, validate_manifest


_resolved: dict[str, Any] | None = None


class ModuleCapabilityError(ValueError):
    """Compatibility exception retained for callers importing the old type."""

    def __init__(self, message: str, *, details: list[str] | None = None):
        super().__init__(message)
        self.details = details or []

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": "MODULE_CAPABILITY_ERROR",
            "message": str(self),
            "details": list(self.details),
        }


def resolve_capabilities() -> dict[str, Any]:
    """Return the open-by-default repository module capability map."""
    validate_manifest()
    modules = [
        {
            "code": code,
            "name": meta["name"],
            "enabled": bool(meta.get("enabled_by_default", True)),
            "reason": None,
            "requires": list(meta.get("requires") or []),
        }
        for code, meta in MODULES.items()
    ]
    enabled_codes = [item["code"] for item in modules if item["enabled"]]
    return {
        "modules": modules,
        "enabled_codes": enabled_codes,
        "by_code": {item["code"]: item for item in modules},
    }


def set_resolved_capabilities(capabilities: dict[str, Any] | None) -> None:
    """Set the process cache for compatibility with isolated test setup."""
    global _resolved
    _resolved = deepcopy(capabilities) if capabilities is not None else None


def get_capabilities() -> dict[str, Any]:
    """Return process capabilities, resolving the manifest on first access."""
    global _resolved
    if _resolved is None:
        _resolved = resolve_capabilities()
    return deepcopy(_resolved)


def get_enabled_module_codes() -> set[str]:
    """Return every repository module code.

    This intentionally derives from the manifest rather than mutable runtime
    configuration. Menu visibility and external readiness are separate gates.
    """
    return set(list_module_codes())


def is_module_enabled(code: str) -> bool:
    return code in set(list_module_codes())


def capabilities_public_payload(_capabilities: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the public open-module payload.

    The argument remains accepted for composition-root compatibility, but a
    caller cannot use an injected capability map to hide repository modules.
    """
    validate_manifest()
    return {
        "modules": [
            {"code": code, "enabled": True, "reason": None}
            for code in list_module_codes()
        ],
    }
