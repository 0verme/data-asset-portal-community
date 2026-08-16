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

"""Resolve module enable/disable configuration and dependency policy.

Configuration (environment variables, single source — no second system):

  ASSET_EDITION              default ``private``
  ASSET_ENABLED_MODULES      comma-separated codes, or ``all`` / empty = defaults
  ASSET_DISABLED_MODULES     comma-separated codes forced off after enable list
  ASSET_MODULE_STRICT        ``1/true`` force fail-fast dependency policy

Dependency policy:

  * Strict (dev/test or ASSET_MODULE_STRICT): illegal requires → raise
  * Normal runtime: auto-disable dependents with ``required_module_disabled:<code>``
"""

from __future__ import annotations

import logging
import os
from copy import deepcopy
from typing import Any

from ..settings import parse_bool, parse_comma_separated_values
from .modules import MODULES, list_module_codes, validate_manifest


LOGGER = logging.getLogger(__name__)

REASON_DISABLED_BY_CONFIGURATION = "disabled_by_configuration"
REASON_NOT_IN_ENABLED_LIST = "not_in_enabled_list"
REASON_REQUIRED_PREFIX = "required_module_disabled:"

_STRICT_ENVIRONMENTS = {"development", "dev", "test"}

# Process-wide resolved capabilities (set during create_app).
_resolved: dict[str, Any] | None = None


class ModuleCapabilityError(ValueError):
    """Raised for invalid module configuration in strict mode."""

    def __init__(self, message: str, *, details: list[str] | None = None):
        super().__init__(message)
        self.details = details or []

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": "MODULE_CAPABILITY_ERROR",
            "message": str(self),
            "details": list(self.details),
        }


def _environment_name() -> str:
    return os.getenv("FLASK_ENV", "production").strip().lower()


def is_strict_module_mode() -> bool:
    if parse_bool(os.getenv("ASSET_MODULE_STRICT")):
        return True
    return _environment_name() in _STRICT_ENVIRONMENTS


def get_edition() -> str:
    return (os.getenv("ASSET_EDITION") or "private").strip() or "private"


def _parse_module_list(raw: str | None) -> list[str] | None:
    """Return None when the env is unset/blank (use defaults); else token list."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return parse_comma_separated_values(text)


def _unknown_codes(codes: list[str]) -> list[str]:
    known = set(MODULES)
    return sorted({code for code in codes if code not in known and code.lower() != "all"})


def resolve_capabilities(
    *,
    enabled: list[str] | None = None,
    disabled: list[str] | None = None,
    edition: str | None = None,
    strict: bool | None = None,
) -> dict[str, Any]:
    """Resolve the effective module capability map.

    When *enabled* / *disabled* / *edition* / *strict* are omitted, values are
    read from environment variables.
    """
    validate_manifest()

    edition_value = (edition if edition is not None else get_edition()).strip() or "private"
    strict_mode = is_strict_module_mode() if strict is None else bool(strict)

    if enabled is None:
        enabled = _parse_module_list(os.getenv("ASSET_ENABLED_MODULES"))
        if enabled is None and edition_value == "community":
            enabled = [
                code
                for code, meta in MODULES.items()
                if meta.get("edition") == "community"
            ]
    if disabled is None:
        disabled = _parse_module_list(os.getenv("ASSET_DISABLED_MODULES")) or []

    errors: list[str] = []

    if enabled is not None:
        unknown_enabled = _unknown_codes(enabled)
        if unknown_enabled:
            errors.append(f"unknown module code(s) in ASSET_ENABLED_MODULES: {', '.join(unknown_enabled)}")
    unknown_disabled = _unknown_codes(disabled or [])
    if unknown_disabled:
        errors.append(f"unknown module code(s) in ASSET_DISABLED_MODULES: {', '.join(unknown_disabled)}")

    # Base: default enable flags from manifest.
    states: dict[str, dict[str, Any]] = {}
    for code, meta in MODULES.items():
        states[code] = {
            "code": code,
            "name": meta["name"],
            "enabled": bool(meta.get("enabled_by_default", True)),
            "reason": None,
            "requires": list(meta.get("requires") or []),
            "edition": meta.get("edition") or "private",
        }

    # Explicit enable list (when set and not "all") restricts the set.
    if enabled is not None:
        enabled_set = {c for c in enabled if c.lower() != "all"}
        use_all = any(c.lower() == "all" for c in enabled) or not enabled_set
        if not use_all:
            for code, state in states.items():
                if code not in enabled_set:
                    if state["enabled"]:
                        state["enabled"] = False
                        state["reason"] = REASON_NOT_IN_ENABLED_LIST

    # Explicit disable list always wins.
    for code in disabled or []:
        if code not in states:
            continue
        states[code]["enabled"] = False
        states[code]["reason"] = REASON_DISABLED_BY_CONFIGURATION

    # Resolve requires iteratively (dependents of disabled modules).
    changed = True
    while changed:
        changed = False
        for code, state in states.items():
            if not state["enabled"]:
                continue
            for req in state["requires"]:
                if req not in states:
                    errors.append(f"module {code!r} requires unknown module {req!r}")
                    continue
                if not states[req]["enabled"]:
                    reason = f"{REASON_REQUIRED_PREFIX}{req}"
                    if strict_mode:
                        errors.append(
                            f"module {code!r} requires {req!r} which is disabled"
                        )
                    else:
                        state["enabled"] = False
                        state["reason"] = reason
                        changed = True
                        LOGGER.warning(
                            "module auto-disabled code=%s reason=%s",
                            code,
                            reason,
                        )
                    break

    if errors:
        message = "invalid module capability configuration: " + "; ".join(errors)
        if strict_mode:
            raise ModuleCapabilityError(message, details=errors)
        for err in errors:
            LOGGER.error("module capability config error (non-strict): %s", err)

    modules_list = [states[code] for code in list_module_codes()]
    enabled_codes = [item["code"] for item in modules_list if item["enabled"]]

    return {
        "edition": edition_value,
        "strict": strict_mode,
        "modules": modules_list,
        "enabled_codes": enabled_codes,
        "by_code": states,
    }


def set_resolved_capabilities(capabilities: dict[str, Any] | None) -> None:
    global _resolved
    _resolved = deepcopy(capabilities) if capabilities is not None else None


def get_capabilities() -> dict[str, Any]:
    """Return process capabilities, resolving from env on first access."""
    global _resolved
    if _resolved is None:
        _resolved = resolve_capabilities()
    return deepcopy(_resolved)


def get_enabled_module_codes() -> set[str]:
    caps = get_capabilities()
    return set(caps.get("enabled_codes") or [])


def is_module_enabled(code: str) -> bool:
    return code in get_enabled_module_codes()


def capabilities_public_payload(capabilities: dict[str, Any] | None = None) -> dict[str, Any]:
    """Strip internal fields for the HTTP capabilities response."""
    caps = capabilities if capabilities is not None else get_capabilities()
    return {
        "edition": caps.get("edition") or "private",
        "modules": [
            {
                "code": item["code"],
                "enabled": bool(item.get("enabled")),
                "reason": item.get("reason"),
            }
            for item in caps.get("modules") or []
        ],
    }
