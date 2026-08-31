# FastAPI Router Module Convention

This document records the incremental convention introduced by Issue #146. It is
an architecture migration guide, not a request to rewrite every adapter in one
change.

## Convention

A migrated router module owns a module-level `APIRouter` and its module-level
handlers:

```python
router = APIRouter(
    prefix="/api/example",
    tags=["example"],
    dependencies=[Depends(require_authenticated)],
)


def get_example_service(request: Request) -> ExampleService:
    return request.app.state.example_service


@router.get("")
def list_examples(service=Depends(get_example_service)):
    ...
```

The application factory remains the composition root:

1. choose the production service or an explicitly supplied test service;
2. place that service on the application state under a module-owned name;
3. call `app.include_router(router)` in the existing registration order.

This keeps the service injection seam explicit. Tests may use the factory's
`*_service_instance` argument, `app.state`, or
`app.dependency_overrides[get_example_service]`; no dependency container or
framework-specific service singleton is introduced.

A router migration must preserve the existing path, method, route name, prefix,
tags, route order, authentication and permission dependencies, request and
response contracts, and status behavior. The router module must not perform
business composition or change service behavior.

## Pilot

`backend/app/fastapi/routers/operation_logs.py` is the first pilot. It has two
read-only routes, one service dependency, an existing explicit factory seam,
and focused authentication/RBAC coverage. Its route contract is:

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/operation-logs` | `operation_log:read` |
| GET | `/api/operation-logs/{log_id}` | `operation_log:read` |

The composition root still includes the pilot at the same position as before,
so the application route order is unchanged.

## Inventory and migration risk

The inventory below is based on the current FastAPI adapter modules. `LOW`
means a small, well-covered module with a narrow service seam; `MEDIUM` means
multiple handlers or mutation/contract concerns; `HIGH` means security,
multiple composition inputs, external integrations, or a large mutation
surface.

| Module | Current registration | Service / composition inputs | Prefix | Routes | Risk | Suggested batch |
| --- | --- | --- | --- | ---: | --- | --- |
| operation logs | `_register_operation_log_routes` | operation-log service | `/api/operation-logs` | 2 | LOW | pilot (#146) |
| lineage | `_register_lineage_routes` | reader adapter / external storage | `/api/lineage` | 4 | MEDIUM | next low-risk batch |
| field mappings | `_register_field_mapping_routes` | field-mapping service / `field_mapping:write` | `/api/field-mappings` | 5 | MEDIUM | batch import (#187) |
| reports | `_register_report_routes` | report service | `/api/reports` | 5 | MEDIUM | after pilot validation |
| roots | `_register_root_routes` | root service | `/api/roots` | 7 | MEDIUM | after pilot validation |
| manual code tables | `_register_manual_code_table_routes` | code-table service | `/api/manual-code-tables` | 7 | MEDIUM | mutation batch |
| upstream | `_register_upstream_routes` | upstream service / permission paths | `/api/upstreams` | 7 | MEDIUM | integration batch |
| API assets | `_register_api_asset_routes` | API-asset service / dynamic row routes | `/api/api-assets` | 9 | MEDIUM | integration batch |
| assets | `_register_asset_routes` | asset service / field mutation paths | `/api/assets` | 10 | MEDIUM | mutation batch |
| push | `_register_push_routes` | push service / jobs / external systems | `/api/push` | 9 | HIGH | later, with integration coverage |
| metadata | `_register_metadata_routes` | ingestion service / duplicate aliases | `/api/metadata` | 5 | HIGH | later, preserve aliases |
| infrastructure | `_register_infrastructure_routes` | capabilities, portal stats, search | three prefixes | 3 | HIGH | separate multi-input batch |
| system management | `_register_system_management_routes` | admin service / 25 admin routes | `/api/system` | 25 | HIGH | last, security-focused |
| auth | `_register_auth_routes` | auth, operation logs, login limiter | `/api/auth` | 3 | HIGH | last, auth-focused |

The next batch should be lineage and field mappings only if the pilot's route
contract and dependency-override tests remain green. Auth, system management,
metadata, push, and infrastructure are intentionally not pilot candidates.

## Validation gate

For each migration, compare the route inventory before and after, including
method, path, name, tags, dependency names, order, and response status. Run the
migrated module tests, authentication/RBAC tests, the FastAPI runtime tests,
the full backend unit suite, SQLite migration/runtime validation, and the
repository's supported database/package checks. A failed compatibility or
security check stops the batch rather than being hidden by a broad rewrite.
