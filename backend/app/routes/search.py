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

from flask import Blueprint, jsonify, request

from ..services.search_provider import (
    SCOPE_ALL,
    SearchDataSourceError,
    search_provider,
)


search_bp = Blueprint("search", __name__)


@search_bp.get("")
def unified_search():
    query = request.args.get("q", "")
    scope = (
        request.args.get("scope")
        or request.args.get("type")
        or request.args.get("module")
        or SCOPE_ALL
    )
    limit = request.args.get("limit", "5")
    try:
        result = search_provider.search(query, scope=scope, limit=limit)
    except SearchDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(result)
