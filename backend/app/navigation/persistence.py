"""Portable persistence for canonical application menu defaults."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, insert, select

from ..db.core import execute_core, fetch_all_core
from ..db.facade import database_transaction
from ..db.tables import menu_table


_MANIFEST_PATH = Path(__file__).resolve().parents[3] / "config" / "default-menus.json"


def _load_default_menus() -> tuple[dict, ...]:
    menus = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    if not isinstance(menus, list):
        raise ValueError("default menu manifest must contain a JSON array")
    codes = [menu.get("code") for menu in menus]
    ids = [menu.get("id") for menu in menus]
    if len(codes) != len(set(codes)) or len(ids) != len(set(ids)):
        raise ValueError("default menu manifest ids and codes must be unique")
    return tuple(menus)


DEFAULT_MENUS = _load_default_menus()


@dataclass(frozen=True, slots=True)
class MenuSeedResult:
    """Counts returned by one insert-missing menu seed attempt."""

    inserted: int
    total: int


def seed_menus_for_profile(profile_name: str) -> MenuSeedResult:
    """Insert missing canonical menus without overwriting instance settings.

    All reads and inserts run through SQLAlchemy Core and the active profile's
    schema translation. The transaction is owned by this seed operation so a
    failed insert rolls back the complete set of defaults.
    """
    inserted = 0
    with database_transaction():
        _columns, existing_rows = fetch_all_core(
            profile_name,
            select(menu_table.c.menu_code, menu_table.c.menu_id),
        )
        existing_codes = {str(row[0]) for row in existing_rows}
        used_ids = {int(row[1]) for row in existing_rows if row[1] is not None}
        next_id = max(used_ids, default=0) + 1

        for menu in DEFAULT_MENUS:
            code = str(menu["code"])
            if code in existing_codes:
                continue

            menu_id = int(menu["id"])
            if menu_id in used_ids:
                while next_id in used_ids:
                    next_id += 1
                menu_id = next_id
                next_id += 1

            values = {
                "menu_id": menu_id,
                "menu_code": code,
                "menu_name": menu["name"],
                "menu_icon": menu["icon"],
                "menu_path": menu["path"],
                "display_order": menu["order"],
                "nav_placement": menu["navPlacement"],
                "admin_only": "Y" if menu["adminOnly"] else "N",
                "is_active": "Y" if menu["status"] == "enabled" else "N",
                "menu_desc": menu["desc"],
                "remark": "系统初始化",
            }
            execute_core(profile_name, insert(menu_table).values(**values))
            existing_codes.add(code)
            used_ids.add(menu_id)
            inserted += 1

        _count_columns, count_rows = fetch_all_core(
            profile_name,
            select(func.count()).select_from(menu_table),
        )
        total = int(count_rows[0][0])

    return MenuSeedResult(inserted=inserted, total=total)
