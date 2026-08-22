"""Thin import facade for the FastAPI Native adapter.

The modular implementation lives under ``backend.app.fastapi``. This module
keeps the stable historical import path used by integrations and tests; it
contains no Flask compatibility code.
"""

from .fastapi.app import create_fastapi_app

__all__ = ["create_fastapi_app"]
