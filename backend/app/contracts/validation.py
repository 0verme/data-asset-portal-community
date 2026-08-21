"""Contract validation helpers for existing HTTP adapters."""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel


ModelT = TypeVar("ModelT", bound=BaseModel)


def validate_contract(payload: Any, model: type[ModelT]) -> Any:
    """Validate a wire payload and return it unchanged.

    Returning the original object is deliberate: the Contract describes the
    existing JSON, including legacy/additive fields and nullable semantics.
    Flask compatibility and FastAPI primary adapters reuse the same model
    after parity coverage without changing serialization semantics.
    """
    model.model_validate(payload)
    return payload
