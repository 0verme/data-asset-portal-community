"""Small DB-API adapter contract shared by runtime database engines."""

from __future__ import annotations

from typing import Protocol


class DatabaseAdapter(Protocol):
    def connect(self, config: dict):
        """Return a DB-API compatible connection with transactions enabled."""
