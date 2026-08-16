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

"""Lineage snapshot reader — display path only.

Must never import the private scheduler collector (``lineage_collector`` or the
scheduler metadata tables ``p_job_*`` / ``p_program_*``).
"""

from __future__ import annotations

# Re-export the existing read implementation. Implementation stays in
# lineage_service for compatibility with current tests and call sites;
# this module is the documented import boundary for HTTP routes.
from ..lineage_service import (  # noqa: F401
    LineageConfigurationError,
    LineageDataSourceError,
    LineageNoActiveSnapshotError,
    LineageNotFoundError,
    LineageValidationError,
    get_bootstrap,
    get_initial_view,
    get_subgraph,
    log_lineage_storage_status,
    lineage_storage_status,
    search_nodes,
)

__all__ = [
    "LineageConfigurationError",
    "LineageDataSourceError",
    "LineageNoActiveSnapshotError",
    "LineageNotFoundError",
    "LineageValidationError",
    "get_bootstrap",
    "get_initial_view",
    "get_subgraph",
    "lineage_storage_status",
    "log_lineage_storage_status",
    "search_nodes",
]
