"""FastAPI adapter composition root."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from ..core.capabilities import resolve_capabilities
from ..services.api_asset_service import api_asset_service
from ..services.assets_service import assets_service
from ..services.field_mapping_service import field_mapping_service
from ..services.indicator_service import indicator_service
from ..services.manual_code_table_service import manual_code_table_service
from ..services.operation_log_service import operation_log_service
from ..services.report_service import report_service
from ..services.root_service import root_service
from ..services.system_management_service import system_management_service
from ..services.upstream_service import upstream_service
from .dependencies import IdentityResolver
from .errors import register_exception_handlers
from .routers.api_assets import _register_api_asset_routes
from .routers.assets import _register_asset_routes
from .routers.field_mappings import _register_field_mapping_routes
from .routers.indicators import _register_indicator_routes
from .routers.lineage import _register_lineage_routes, lineage_service
from .routers.manual_code_tables import _register_manual_code_table_routes
from .routers.operation_logs import _register_operation_log_routes
from .routers.reports import _register_report_routes
from .routers.roots import _register_root_routes
from .routers.system import _register_system_management_routes
from .routers.upstream import _register_upstream_routes


def create_fastapi_app(
    *,
    capabilities: dict[str, Any] | None = None,
    identity_resolver: IdentityResolver | None = None,
    indicator_service_instance: Any | None = None,
    assets_service_instance: Any | None = None,
    field_mapping_service_instance: Any | None = None,
    root_service_instance: Any | None = None,
    manual_code_table_service_instance: Any | None = None,
    report_service_instance: Any | None = None,
    api_asset_service_instance: Any | None = None,
    lineage_service_instance: Any | None = None,
    system_management_service_instance: Any | None = None,
    operation_log_service_instance: Any | None = None,
    upstream_service_instance: Any | None = None,
) -> FastAPI:
    """Create the FastAPI primary application for migrated API prefixes.

    ``identity_resolver`` is the explicit auth adapter seam. Production
    deployment provides the resolver that bridges its session/token runtime;
    tests can inject an identity without Flask request context.
    """
    app = FastAPI(title="Data Asset Portal FastAPI", version="0.1.0")
    app.state.identity_resolver = identity_resolver or (lambda _request: None)
    indicator = indicator_service_instance or indicator_service
    assets = assets_service_instance or assets_service
    field_mapping = field_mapping_service_instance or field_mapping_service
    root = root_service_instance or root_service
    manual_code_table = manual_code_table_service_instance or manual_code_table_service
    report = report_service_instance or report_service
    api_asset = api_asset_service_instance or api_asset_service
    lineage = lineage_service_instance or lineage_service
    system_management = system_management_service_instance or system_management_service
    operation_logs = operation_log_service_instance or operation_log_service
    upstream = upstream_service_instance or upstream_service

    register_exception_handlers(app)

    effective_capabilities = capabilities
    if effective_capabilities is None:
        effective_capabilities = resolve_capabilities()
    enabled_codes = set(effective_capabilities.get("enabled_codes") or [])
    if "indicator" in enabled_codes:
        _register_indicator_routes(app, indicator)
    if "dwm" in enabled_codes:
        _register_asset_routes(app, assets)
    if "mapping" in enabled_codes:
        _register_field_mapping_routes(app, field_mapping)
    if "root" in enabled_codes:
        _register_root_routes(app, root)
    if "codeTable" in enabled_codes:
        _register_manual_code_table_routes(app, manual_code_table)
    if "report" in enabled_codes:
        _register_report_routes(app, report)
    if "apiAsset" in enabled_codes:
        _register_api_asset_routes(app, api_asset)
    if "lineage" in enabled_codes:
        _register_lineage_routes(app, lineage)
    if "system" in enabled_codes:
        _register_system_management_routes(app, system_management)
        _register_operation_log_routes(app, operation_logs)
    if "upstream" in enabled_codes:
        _register_upstream_routes(app, upstream)
    return app
