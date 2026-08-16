# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Lineage snapshot repository (read path).

Reads ``p_lineage_snapshot`` / ``p_lineage_node`` / ``p_lineage_edge`` only.
Does not touch scheduler source tables.
"""

from __future__ import annotations

from ..lineage_service import (
    lineage_storage_status,
    log_lineage_storage_status,
    _current_snapshot,
    _database_snapshot,
)

__all__ = [
    "lineage_storage_status",
    "log_lineage_storage_status",
    "load_active_snapshot",
    "load_database_snapshot",
]


def load_active_snapshot():
    """Load the active snapshot for the current storage mode (POC or DB)."""
    return _current_snapshot()


def load_database_snapshot(profile: str):
    """Load active snapshot rows from the given DB profile."""
    return _database_snapshot(profile)
