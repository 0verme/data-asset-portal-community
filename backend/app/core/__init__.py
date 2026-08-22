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

"""Core module capability and provider registration."""

from .capabilities import (
    ModuleCapabilityError,
    get_capabilities,
    get_enabled_module_codes,
    is_module_enabled,
    resolve_capabilities,
)
from .modules import MODULES, get_module_manifest, list_module_codes

__all__ = [
    "MODULES",
    "ModuleCapabilityError",
    "get_capabilities",
    "get_enabled_module_codes",
    "get_module_manifest",
    "is_module_enabled",
    "list_module_codes",
    "resolve_capabilities",
]
