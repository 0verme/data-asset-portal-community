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

"""Expose the repository module capability compatibility contract.

The repository module manifest is the source of truth for source-backed
module identity. Database providers, external integrations, storage profiles,
and instance menu state are reported by their own contracts and do not change
whether a repository module exists. The capability terminology is retained for
the existing API/import contract; it is not a generic readiness or entitlement
gate.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .modules import MODULES, list_module_codes, validate_manifest


_resolved: dict[str, Any] | None = None


class ModuleCapabilityError(ValueError):
    """Compatibility exception retained for the historical capability name.

    This type is not a deployment-readiness error and does not represent an
    Edition, license, menu, permission, or runtime-profile decision.
    """

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
    """Return the in-process repository-module capability representation.

    ``enabled`` and ``enabled_codes`` are compatibility field names for the
    open, source-backed module contract. They are not mutable feature gates,
    licensing entitlements, menu visibility, RBAC permissions, runtime profile
    selection, or dependency readiness.
    """
    validate_manifest()
    modules = [
        {
            "code": code,
            "name": meta["name"],
            # Every manifest entry is source-backed/open. Keep the legacy
            # `enabled` field true without turning manifest metadata into a
            # mutable or Edition-style module gate.
            "enabled": True,
            "reason": None,
            "requires": list(meta.get("requires") or []),
        }
        for code, meta in MODULES.items()
    ]
    enabled_codes = list_module_codes()
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
    """Return the cached repository-module capability contract."""
    global _resolved
    if _resolved is None:
        _resolved = resolve_capabilities()
    return deepcopy(_resolved)


def get_repository_module_codes() -> set[str]:
    """Return source-backed repository module codes as a set.

    This derives from the static manifest rather than mutable runtime
    configuration. Menu visibility, RBAC authorization, runtime profiles, and
    external readiness are separate contracts.
    """
    return set(list_module_codes())


def get_enabled_module_codes() -> set[str]:
    """Compatibility alias for :func:`get_repository_module_codes`.

    The old name is retained for import compatibility; ``enabled`` here does
    not mean a mutable feature, menu, license, permission, or readiness gate.
    """
    return get_repository_module_codes()


def is_repository_module(code: str) -> bool:
    """Return whether ``code`` is present in the repository module manifest."""
    return code in MODULES


def is_module_enabled(code: str) -> bool:
    """Compatibility alias for :func:`is_repository_module`."""
    return is_repository_module(code)


def capabilities_public_payload(_capabilities: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the public repository-module capability payload.

    The endpoint name and ``modules[].enabled``/``reason`` fields remain stable
    compatibility terms. The fields describe source-backed open modules only;
    they are not license entitlements, menu status, RBAC permissions, runtime
    profile selection, or dependency readiness. The argument remains accepted
    for composition-root compatibility, but an injected map cannot hide
    repository modules.
    """
    validate_manifest()
    return {
        "modules": [
            {"code": code, "enabled": True, "reason": None}
            for code in list_module_codes()
        ],
    }
