"""Explicit API contracts shared by Flask and future FastAPI adapters."""

from .models import (
    AssetField,
    AssetItem,
    AssetPageResponse,
    AssetTableRequest,
    DataEnvelope,
    ErrorEnvelope,
    ErrorModel,
    IndicatorItem,
    IndicatorRequest,
    IndicatorListResponse,
    ItemsResponse,
    MessageDataResponse,
    ReportItem,
    ReportListResponse,
    ReportRequest,
)
from .validation import validate_contract

__all__ = [
    "AssetField",
    "AssetItem",
    "AssetPageResponse",
    "AssetTableRequest",
    "DataEnvelope",
    "ErrorEnvelope",
    "ErrorModel",
    "IndicatorItem",
    "IndicatorListResponse",
    "IndicatorRequest",
    "ItemsResponse",
    "MessageDataResponse",
    "ReportItem",
    "ReportListResponse",
    "ReportRequest",
    "validate_contract",
]
