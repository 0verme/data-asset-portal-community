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

"""Lineage package boundary.

Public surface for HTTP / portal read path (reader only)::

    from backend.app.services.lineage import get_bootstrap, get_subgraph, ...

External collector (scheduler metadata → snapshot) is NOT re-exported here.
Import it only from scripts or deployment tooling::

    from backend.app.services.lineage_collector import collect_and_publish

This separation ensures Community/read-only deployments can keep snapshot
reading without shipping or importing the external job/program collector.
"""

from .reader import (
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
