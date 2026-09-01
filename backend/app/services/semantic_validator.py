"""Deterministic validation for the minimal indicator semantic contract."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

ALLOWED_AGGREGATIONS = frozenset(
    {"SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "NONE"}
)
ALLOWED_SEMANTIC_STATES = frozenset({"candidate", "certified", "deprecated"})
DEFAULT_SEMANTIC_STATE = "candidate"
DEFAULT_STATUS_VALUES = frozenset({"enabled", "disabled"})


@dataclass(frozen=True)
class SemanticValidationResult:
    """Normalized semantic values and deterministic validation details."""

    source_asset_id: int | None
    result_field_id: int | None
    aggregation: str | None
    semantic_state: str
    errors: tuple[dict[str, str], ...] = ()

    @property
    def valid(self) -> bool:
        return not self.errors


def normalize_reference_id(
    value: Any, field: str
) -> tuple[int | None, dict[str, str] | None]:
    """Normalize a stable numeric reference without accepting ambiguous values."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, None
    if isinstance(value, bool) or isinstance(value, float) and not value.is_integer():
        return None, {"field": field, "message": f"{field} must be a positive integer"}
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return None, {"field": field, "message": f"{field} must be a positive integer"}
    if normalized < 1:
        return None, {"field": field, "message": f"{field} must be a positive integer"}
    return normalized, None


def _deleted(row: Mapping[str, Any] | None) -> bool:
    return str(row.get("is_deleted") or "").upper() == "Y" if row else False


def _row_id(row: Mapping[str, Any] | None, key: str) -> int | None:
    if not row:
        return None
    try:
        return int(row[key])
    except (KeyError, TypeError, ValueError):
        return None


def validate_indicator_semantics(
    *,
    source_asset_id: Any = None,
    result_field_id: Any = None,
    aggregation: Any = None,
    semantic_state: Any = None,
    status: Any = None,
    asset: Mapping[str, Any] | None = None,
    field: Mapping[str, Any] | None = None,
    allowed_statuses: Iterable[str] = DEFAULT_STATUS_VALUES,
) -> SemanticValidationResult:
    """Validate references, aggregation, lifecycle and availability state.

    Database lookup is deliberately outside this function. Callers provide the
    rows resolved by stable IDs, which keeps this validator deterministic and
    reusable by CRUD or future candidate-validation code without any model or
    network dependency.
    """
    errors: list[dict[str, str]] = []
    normalized_source, source_error = normalize_reference_id(
        source_asset_id, "sourceAssetId"
    )
    normalized_field, field_error = normalize_reference_id(
        result_field_id, "resultFieldId"
    )
    if source_error:
        errors.append(source_error)
    if field_error:
        errors.append(field_error)

    if normalized_field is not None:
        resolved_field_id = _row_id(field, "field_id")
        if field is None or resolved_field_id is None:
            errors.append(
                {
                    "field": "resultFieldId",
                    "message": f"result field does not exist: {normalized_field}",
                }
            )
        elif _deleted(field):
            errors.append(
                {
                    "field": "resultFieldId",
                    "message": f"result field is deleted: {normalized_field}",
                }
            )
        else:
            field_asset_id = _row_id(field, "asset_id")
            if field_asset_id is None:
                errors.append(
                    {
                        "field": "resultFieldId",
                        "message": "result field has no valid asset reference",
                    }
                )
            elif normalized_source is None:
                normalized_source = field_asset_id
            elif field_asset_id != normalized_source:
                errors.append(
                    {
                        "field": "resultFieldId",
                        "message": "result field does not belong to source asset",
                    }
                )

    # A field-only reference deterministically infers its parent asset, which
    # must still be resolved and active before the contract is accepted.
    if normalized_source is not None:
        resolved_asset_id = _row_id(asset, "asset_id")
        if asset is None or resolved_asset_id is None:
            errors.append(
                {
                    "field": "sourceAssetId",
                    "message": f"asset does not exist: {normalized_source}",
                }
            )
        elif resolved_asset_id != normalized_source:
            errors.append(
                {
                    "field": "sourceAssetId",
                    "message": "asset reference could not be resolved deterministically",
                }
            )
        elif _deleted(asset):
            errors.append(
                {
                    "field": "sourceAssetId",
                    "message": f"asset is deleted: {normalized_source}",
                }
            )

    normalized_aggregation = None
    if aggregation is not None and str(aggregation).strip():
        normalized_aggregation = str(aggregation).strip().upper()
        if normalized_aggregation not in ALLOWED_AGGREGATIONS:
            errors.append(
                {
                    "field": "aggregation",
                    "message": f"aggregation must be one of: {', '.join(sorted(ALLOWED_AGGREGATIONS))}",
                }
            )

    normalized_state = str(semantic_state or DEFAULT_SEMANTIC_STATE).strip().lower()
    if normalized_state not in ALLOWED_SEMANTIC_STATES:
        errors.append(
            {
                "field": "semanticState",
                "message": f"semanticState must be one of: {', '.join(sorted(ALLOWED_SEMANTIC_STATES))}",
            }
        )

    if status is not None:
        normalized_status = str(status).strip()
        allowed = {
            str(value).strip() for value in allowed_statuses if str(value).strip()
        }
        if normalized_status not in allowed:
            errors.append(
                {
                    "field": "status",
                    "message": f"status is not allowed: {normalized_status}",
                }
            )

    return SemanticValidationResult(
        source_asset_id=normalized_source,
        result_field_id=normalized_field,
        aggregation=normalized_aggregation,
        semantic_state=normalized_state,
        errors=tuple(errors),
    )
