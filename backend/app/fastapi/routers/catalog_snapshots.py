"""Workload-only read representation in the existing assets resource family."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ...services.catalog_snapshot_service import SnapshotError
from ..dependencies import require_authenticated

_NO_STORE = {"Cache-Control": "no-store", "Vary": "Authorization, X-DAP-Workload"}


def _register_catalog_snapshot_routes(app, service):
    # Deliberately separate from the ordinary browser catalog dependency:
    # a workload grant is its own narrowly scoped proof, never a browser login.
    router = APIRouter(
        prefix="/api/assets/snapshots",
        tags=["asset-snapshots"],
        dependencies=[Depends(require_authenticated)] if service is None else [],
    )

    def read(request, catalog_id, scope_id, snapshot_id, *, manifest=False):
        try:
            if service is None:
                raise SnapshotError("SNAPSHOT_DISABLED")
            # Do not accept client-supplied forwarded headers as transport proof.
            if request.scope.get("scheme") != "https":
                raise SnapshotError("SNAPSHOT_FORBIDDEN")
            headers = request.headers.getlist("authorization")
            if len(headers) != 1:
                raise SnapshotError("SNAPSHOT_AUTH_REQUIRED")
            parts = headers[0].split(" ")
            if len(parts) != 2 or parts[0].lower() != "bearer":
                raise SnapshotError("SNAPSHOT_AUTH_REQUIRED")
            workloads = request.headers.getlist("x-dap-workload")
            if len(workloads) != 1:
                raise SnapshotError("SNAPSHOT_FORBIDDEN")
            query = request.query_params
            allowed = set() if manifest else {"cursor", "pageSize"}
            if set(query) - allowed or len(query.multi_items()) != len(query):
                raise SnapshotError("SNAPSHOT_INPUT_INVALID")
            credentials = {
                "catalog_id": catalog_id, "scope_id": scope_id,
                "snapshot_id": snapshot_id, "workload_id": workloads[0], "proof": parts[1],
            }
            if manifest:
                payload = service.confirm_manifest(**credentials)
            else:
                page_size = query.get("pageSize")
                if page_size is not None:
                    if not page_size.isascii() or not page_size.isdecimal() or len(page_size) > 3:
                        raise SnapshotError("SNAPSHOT_INPUT_INVALID")
                    page_size = int(page_size)
                    if not 1 <= page_size <= 200:
                        raise SnapshotError("SNAPSHOT_INPUT_INVALID")
                cursor = query.get("cursor")
                if cursor is not None and (len(cursor) != 64 or not cursor.isascii()):
                    raise SnapshotError("SNAPSHOT_CURSOR_INVALID")
                payload = service.read_page(**credentials, cursor=cursor, page_size=page_size)
            return JSONResponse(content=payload, headers=_NO_STORE)
        except SnapshotError as error:
            return JSONResponse(
                status_code=error.status,
                content={"error": {"code": error.code, "message": "授权快照读取未完成。"}},
                headers=_NO_STORE,
            )
        except Exception:
            # Fail closed without serializing metadata, proof or exception text.
            return JSONResponse(
                status_code=503,
                content={"error": {"code": "SNAPSHOT_UNAVAILABLE", "message": "授权快照读取未完成。"}},
                headers=_NO_STORE,
            )

    @router.get("/{catalog_id}/{scope_id}/{snapshot_id}", response_model=None)
    def get_snapshot_page(catalog_id: str, scope_id: str, snapshot_id: str, request: Request):
        return read(request, catalog_id, scope_id, snapshot_id)

    @router.get("/{catalog_id}/{scope_id}/{snapshot_id}/manifest", response_model=None)
    def get_snapshot_manifest(catalog_id: str, scope_id: str, snapshot_id: str, request: Request):
        return read(request, catalog_id, scope_id, snapshot_id, manifest=True)

    app.include_router(router)
