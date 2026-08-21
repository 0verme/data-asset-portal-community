"""Compatibility facade for the modular FastAPI adapter."""

from .fastapi.app import create_fastapi_app

__all__ = ["create_fastapi_app"]
