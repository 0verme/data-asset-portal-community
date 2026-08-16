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

"""Public read-only module capability endpoint.

Does not query any optional business tables.
"""

from flask import Blueprint, current_app, jsonify

from ..core.capabilities import capabilities_public_payload, get_capabilities


capabilities_bp = Blueprint("capabilities", __name__)


@capabilities_bp.get("")
def get_module_capabilities():
    # Prefer the snapshot resolved at app creation so tests/runtime stay stable.
    stored = None
    try:
        stored = current_app.extensions.get("module_capabilities")
    except Exception:
        stored = None
    caps = stored if stored is not None else get_capabilities()
    return jsonify(capabilities_public_payload(caps))
