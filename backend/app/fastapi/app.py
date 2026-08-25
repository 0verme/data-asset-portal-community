"""FastAPI adapter composition root."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI  # pyright: ignore[reportAttributeAccessIssue]

from ..authorization.core import AuthorizationService
from ..core.capabilities import resolve_capabilities
from ..services.api_asset_service import api_asset_service
from ..services.assets_service import assets_service
from ..services.auth_service import auth_service
from ..services.field_mapping_service import field_mapping_service
from ..services.indicator_service import indicator_service
from ..services.manual_code_table_service import manual_code_table_service
from ..services.metadata_ingestion_service import (
    metadata_ingestion_service,  # type: ignore
)
from ..services.operation_log_service import operation_log_service
from ..services.portal_service import portal_service
from ..services.push_service import push_service
from ..services.report_service import report_service
from ..services.root_service import root_service
from ..services.search_provider import search_provider
from ..services.system_management_service import system_management_service
from ..services.upstream_service import upstream_service
from ..security.login_protection import LoginAttemptLimiter
from ..settings import get_openapi_docs_enabled
from .auth import LegacySessionMigrationMiddleware
from .dependencies import IdentityResolver, RequestContextMiddleware
from .errors import register_exception_handlers
from .routers.api_assets import _register_api_asset_routes
from .routers.assets import _register_asset_routes
from .routers.auth import _register_auth_routes  # pyright: ignore[reportMissingImports]
from .routers.field_mappings import _register_field_mapping_routes
from .routers.indicators import _register_indicator_routes
from .routers.infrastructure import _register_infrastructure_routes
from .routers.lineage import _register_lineage_routes, lineage_service
from .routers.manual_code_tables import _register_manual_code_table_routes
from .routers.metadata import _register_metadata_routes  # type: ignore
from .routers.operation_logs import router as operation_log_router
from .routers.push import _register_push_routes
from .routers.reports import _register_report_routes
from .routers.roots import _register_root_routes
from .routers.system import _register_system_management_routes
from .routers.upstream import _register_upstream_routes


def create_fastapi_app(
    *,
    capabilities: dict[str, Any] | None = None,
    identity_resolver: IdentityResolver | None = None,
    auth_service_instance: Any | None = None,
    portal_service_instance: Any | None = None,
    search_provider_instance: Any | None = None,
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
    metadata_ingestion_service_instance: Any | None = None,
    upstream_service_instance: Any | None = None,
    push_service_instance: Any | None = None,
    authorization_repository_instance: Any | None = None,
    authorization_service_instance: Any | None = None,
    login_protection_instance: LoginAttemptLimiter | None = None,
    openapi_enabled: bool | None = None,
) -> FastAPI:
    """Create the FastAPI primary application for migrated API prefixes.

    ``identity_resolver`` is the explicit auth adapter seam. Production
    deployment provides the resolver that bridges its session/token runtime;
    tests can inject an identity without Flask request context. The optional
    ``openapi_enabled`` argument is a factory-only override; when omitted,
    only an explicit ``APP_ENV=development`` enables the HTTP docs endpoints.
    """
    docs_enabled = (
        get_openapi_docs_enabled() if openapi_enabled is None else openapi_enabled
    )
    app = FastAPI(
        title="Data Asset Portal FastAPI",
        version="0.1.0",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.state.identity_resolver = identity_resolver or (lambda _request: None)
    app.add_middleware(
        RequestContextMiddleware,
        identity_resolver=app.state.identity_resolver,
    )
    app.add_middleware(LegacySessionMigrationMiddleware)
    auth = auth_service_instance or auth_service
    authorization_service = authorization_service_instance or AuthorizationService(
        authorization_repository_instance
    )
    app.state.authorization_service = authorization_service
    app.state.authorization_repository = authorization_service.repository
    login_protection = (
        login_protection_instance
        if login_protection_instance is not None
        else LoginAttemptLimiter()
    )
    app.state.login_protection = login_protection
    portal_stats = portal_service_instance or portal_service
    search = search_provider_instance or search_provider
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
    app.state.operation_log_service = operation_logs
    metadata_ingestion = metadata_ingestion_service_instance or metadata_ingestion_service
    upstream = upstream_service_instance or upstream_service
    push = push_service_instance or push_service

    # The capability contract is used by the infrastructure payload only.
    # Router registration below is static for every repository module and does
    # not depend on capability, menu, profile, or readiness state.
    effective_capabilities = capabilities or resolve_capabilities()

    register_exception_handlers(app)
    _register_auth_routes(app, auth, operation_logs, login_protection)
    _register_infrastructure_routes(
        app,
        effective_capabilities,
        portal_stats,
        search,
    )
    # Every router shipped in this repository is part of the default runtime.
    # External dependencies report their own diagnostic errors at request time;
    # they do not turn an existing source module into a 404.
    _register_indicator_routes(app, indicator)
    _register_asset_routes(app, assets)
    _register_field_mapping_routes(app, field_mapping)
    _register_root_routes(app, root)
    _register_manual_code_table_routes(app, manual_code_table)
    _register_report_routes(app, report)
    _register_api_asset_routes(app, api_asset)
    _register_lineage_routes(app, lineage)
    _register_metadata_routes(app, metadata_ingestion)
    _register_system_management_routes(app, system_management)
    app.include_router(operation_log_router)
    _register_upstream_routes(app, upstream)
    _register_push_routes(app, push)
    return app
