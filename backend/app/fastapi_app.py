"""Compatibility facade for the FastAPI primary adapter.

The modular implementation lives under ``backend.app.fastapi``. This module
preserves the historical import path used by runtime wiring and tests.
"""

from .fastapi.app import create_fastapi_app

__all__ = ["create_fastapi_app"]
