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

"""Shared asset field-match contract.

Two read entries recall assets by keyword: portal unified search
(``services.search_provider`` + ``services.providers``) and the data-warehouse
asset list (``services.assets_service``, ``GET /api/assets/tables?keyword=``).
Both must recall the *same* assets for the same keyword, so the participating
``p_asset_field`` columns and the active-row flag are declared once here
instead of being copied per entry.
"""

from __future__ import annotations

# ``p_asset_field`` columns searched by keyword, in match order, together with
# the ``matchedFields`` label that explains a hit on that column.
ASSET_FIELD_MATCH_COLUMNS: tuple[tuple[str, str], ...] = (
    ("field_name", "字段名"),
    ("field_cn_name", "字段中文名"),
    ("field_desc", "字段描述"),
)

# Only active fields participate: a deleted field must never recall an asset.
ASSET_FIELD_ACTIVE_VALUE = "N"

# Columns that build the shared match display value: field name plus the first
# available Chinese name / description (``<field_name> <field_cn_name|field_desc>``).
ASSET_FIELD_MATCH_DISPLAY_COLUMNS: tuple[str, ...] = (
    "field_name",
    "field_cn_name",
    "field_desc",
)


def asset_field_match_value(field_row: dict) -> str:
    """Build the shared match display value from a ``p_asset_field`` row."""
    name = str(field_row.get("field_name") or "").strip()
    fallback = str(field_row.get("field_cn_name") or "").strip() or str(
        field_row.get("field_desc") or ""
    ).strip()
    return " ".join(part for part in (name, fallback) if part)
