"""FastAPI adapter for the public Metadata Ingestion Contract."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from ...application import RequestContext
from ...contracts import validate_contract
from ...contracts.metadata_ingestion import (  # type: ignore
    MAX_METADATA_BODY_BYTES,
    AssetMetadataIngestionRequest,
    LineageMetadataIngestionRequest,
    MetadataIngestionResult,
)
from ...services.metadata_ingestion_service import (  # type: ignore
    MetadataIngestionError,
    MetadataPayloadTooLargeError,
    metadata_ingestion_service,
)
from ..dependencies import require_authenticated, require_permission


def _metadata_error_response(error: MetadataIngestionError) -> JSONResponse:
    payload = {
        "error": {
            "code": error.code,
            "message": error.message,
        }
    }
    if error.details is not None:
        payload["error"]["details"] = error.details
        if isinstance(error.details, dict) and error.details.get("ingestionId"):
            payload.update(error.details)
    return JSONResponse(status_code=error.status_code, content=payload)


def _check_metadata_body_size(request: Request) -> None:
    value = request.headers.get("content-length")
    try:
        content_length = int(value) if value else 0
    except (TypeError, ValueError):
        content_length = 0
    if content_length > MAX_METADATA_BODY_BYTES:
        raise MetadataPayloadTooLargeError(
            f"metadata request body exceeds {MAX_METADATA_BODY_BYTES} bytes",
            details={"code": "PAYLOAD_TOO_LARGE", "maxBytes": MAX_METADATA_BODY_BYTES},
        )


def _register_metadata_routes(
    app: FastAPI, service: Any = metadata_ingestion_service
) -> None:
    router = APIRouter(
        prefix="/api/metadata",
        tags=["metadata-ingestion"],
        dependencies=[Depends(require_authenticated)],
    )

    def get_service() -> Any:
        return service

    @router.post(
        "/assets/ingestions",
        response_model=MetadataIngestionResult,
        status_code=201,
        dependencies=[Depends(_check_metadata_body_size)],
    )
    @router.post(
        "/assets:bulk-upsert",
        response_model=MetadataIngestionResult,
        status_code=201,
        include_in_schema=False,
        dependencies=[Depends(_check_metadata_body_size)],
    )
    def ingest_assets(
        payload: AssetMetadataIngestionRequest = Body(...),
        dry_run: bool = Query(default=False, alias="dryRun"),
        mode: str | None = Query(default=None),
        _context: RequestContext = Depends(require_permission("metadata:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            result = current_service.ingest_assets(
                payload,
                dry_run=dry_run or str(mode or "").strip().casefold() == "preview",
            )
        except MetadataIngestionError as error:
            return _metadata_error_response(error)
        return JSONResponse(
            status_code=200
            if dry_run or str(mode or "").strip().casefold() == "preview"
            else 201,
            content=validate_contract(result, MetadataIngestionResult),
        )

    @router.post(
        "/lineage/ingestions",
        response_model=MetadataIngestionResult,
        status_code=201,
        dependencies=[Depends(_check_metadata_body_size)],
    )
    @router.post(
        "/lineage:snapshots",
        response_model=MetadataIngestionResult,
        status_code=201,
        include_in_schema=False,
        dependencies=[Depends(_check_metadata_body_size)],
    )
    def ingest_lineage(
        payload: LineageMetadataIngestionRequest = Body(...),
        dry_run: bool = Query(default=False, alias="dryRun"),
        mode: str | None = Query(default=None),
        _context: RequestContext = Depends(require_permission("metadata:write")),
        current_service: Any = Depends(get_service),
    ):
        try:
            result = current_service.ingest_lineage(
                payload,
                dry_run=dry_run or str(mode or "").strip().casefold() == "preview",
            )
        except MetadataIngestionError as error:
            return _metadata_error_response(error)
        return JSONResponse(
            status_code=200
            if dry_run or str(mode or "").strip().casefold() == "preview"
            else 201,
            content=validate_contract(result, MetadataIngestionResult),
        )

    @router.get("/ingestions/{ingestion_id}", response_model=MetadataIngestionResult)
    def get_ingestion(
        ingestion_id: str,
        _context: RequestContext = Depends(require_permission("metadata:read")),
        current_service: Any = Depends(get_service),
    ):
        try:
            result = current_service.get_ingestion(ingestion_id)
        except MetadataIngestionError as error:
            return _metadata_error_response(error)
        return JSONResponse(content=validate_contract(result, MetadataIngestionResult))

    app.include_router(router)
