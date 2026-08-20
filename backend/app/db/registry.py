"""Backend provider registry and third-party entry-point discovery."""

from __future__ import annotations

from importlib import metadata

from .base import DatabaseBackendProvider, validate_provider_contract

ENTRY_POINT_GROUP = "data_asset_portal.database_backends"
_PROVIDERS: dict[str, DatabaseBackendProvider] = {}
_ENTRY_POINTS_LOADED = False


def register_provider(provider: DatabaseBackendProvider, *, replace: bool = False):
    """Register a provider after validating the public plug-in contract."""
    validate_provider_contract(provider)
    names = (provider.name, *provider.aliases)
    for name in names:
        normalized = name.strip().lower()
        if normalized in _PROVIDERS and not replace:
            raise ValueError(f"database provider already registered: {normalized}")
    for name in names:
        _PROVIDERS[name.strip().lower()] = provider
    return provider


def register_builtin_providers(*, replace: bool = False):
    from .providers import BUILTIN_PROVIDERS

    for provider in BUILTIN_PROVIDERS:
        register_provider(provider, replace=replace)


def _load_entry_points():
    global _ENTRY_POINTS_LOADED
    if not _PROVIDERS:
        register_builtin_providers()
    if _ENTRY_POINTS_LOADED:
        return
    _ENTRY_POINTS_LOADED = True
    for entry_point in metadata.entry_points(group=ENTRY_POINT_GROUP):
        loaded = entry_point.load()
        provider = loaded() if isinstance(loaded, type) else loaded
        register_provider(provider)


def get_provider(name: str) -> DatabaseBackendProvider:
    _load_entry_points()
    normalized = (name or "").strip().lower()
    try:
        return _PROVIDERS[normalized]
    except KeyError as exc:
        supported = ", ".join(available_provider_names())
        raise ValueError(
            f"Unsupported database type: {normalized or '<empty>'}. "
            f"Supported types: {supported}."
        ) from exc


def available_provider_names() -> tuple[str, ...]:
    _load_entry_points()
    return tuple(sorted({provider.name for provider in _PROVIDERS.values()}))


def available_adapter_names(edition: str) -> tuple[str, ...]:
    _load_entry_points()
    from .providers import BUILTIN_PROVIDERS

    names = tuple(provider.name for provider in BUILTIN_PROVIDERS)
    if edition == "community":
        return tuple(name for name in names if name != "gaussdb")
    return names


def clear_registry_for_tests():
    global _ENTRY_POINTS_LOADED
    _PROVIDERS.clear()
    _ENTRY_POINTS_LOADED = False
