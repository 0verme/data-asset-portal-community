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

"""Collector interface for external lineage snapshot generation.

The reader path never imports implementations of this protocol.
Scheduler-based collection remains in
``backend.app.services.lineage_collector`` when an external scheduler/storage profile is configured.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class LineageCollector(Protocol):
    """Build and optionally publish a lineage snapshot."""

    def collect_and_publish(self, profile: str, *, dry_run: bool = False) -> dict[str, Any]:
        """Return a snapshot dict; publish unless *dry_run* is true."""
        ...
