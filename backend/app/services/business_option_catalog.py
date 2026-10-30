"""Read active business options for authenticated editors.

This catalog deliberately has no Demo or hard-coded fallback. Missing categories
remain distinguishable from existing categories with zero enabled items, and
backend data-source failures are allowed to propagate to the API adapter.
"""

from __future__ import annotations

from .common_code_service import common_code_service


def get_business_option_catalog(category_codes: list[str]) -> dict:
    """Return a stable category-keyed projection of configured active values."""
    requested = list(dict.fromkeys(str(code).strip() for code in category_codes if str(code).strip()))
    result = common_code_service.get_items_batch(requested)

    categories = {code: [] for code in requested}
    for item in result.get("items", []):
        category_code = str(item.get("categoryCode") or "")
        if category_code not in categories:
            continue
        value = str(item.get("value") or item.get("name") or "").strip()
        if not value:
            continue
        categories[category_code].append(
            {
                "code": str(item.get("code") or ""),
                "name": str(item.get("name") or value),
                "value": value,
            }
        )

    return {
        "categories": categories,
        "missingCategories": [
            code for code in requested if code in set(result.get("missingCodes", []))
        ],
    }
