"""Contract validation helpers for existing HTTP adapters."""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel


ModelT = TypeVar("ModelT", bound=BaseModel)


def validate_contract(payload: Any, model: type[ModelT]) -> Any:
    """Validate a wire payload and return it unchanged.

    Returning the original object is deliberate: P2 must describe the
    existing JSON, including legacy/additive fields and nullable semantics.
    FastAPI can use the same model as its response model in P3 once parity is
    proven, while Flask keeps byte-for-byte compatible serialization today.
    """
    model.model_validate(payload)
    return payload
