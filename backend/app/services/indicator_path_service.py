from __future__ import annotations

import os

from sqlalchemy import func, select

from ..db.service import CoreAccess
from ..db.tables import indicator_path_config


class IndicatorPathDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "INDICATOR_PATH_DATA_SOURCE_ERROR", "message": self.message}


class IndicatorPathService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=IndicatorPathDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def get_path_tree(self, dimension_code=None):
        """Return enabled path nodes, optionally narrowed to one dimension code.

        A dimension filter matches node codes case-insensitively and keeps the
        path's ancestors plus the matched node's full subtree so the response
        remains a navigable tree at every hierarchy level.
        """
        normalized_dimension = str(dimension_code or "").strip().casefold()
        where = [
            indicator_path_config.c.status.in_(("enabled", "ENABLED", "启用")),
        ]
        statement = (
            select(
                indicator_path_config.c.id,
                indicator_path_config.c.parent_id,
                indicator_path_config.c.path_code,
                indicator_path_config.c.path_name,
                indicator_path_config.c.dimension_code,
                indicator_path_config.c.path_level,
                indicator_path_config.c.full_path,
                indicator_path_config.c.sort_order,
                indicator_path_config.c.status,
                indicator_path_config.c.remark,
            )
            .where(*where)
            .order_by(
                indicator_path_config.c.path_level,
                func.coalesce(indicator_path_config.c.parent_id, 0),
                indicator_path_config.c.sort_order,
                indicator_path_config.c.id,
            )
        )
        rows = self._fetch_rows(statement)

        nodes_by_id = {}
        children_by_parent = {}
        root_ids = []
        for row in rows:
            node_id = int(row["id"])
            parent_id = row.get("parent_id")
            normalized_parent_id = int(parent_id) if parent_id is not None else None
            level = int(row["path_level"])
            label = f"{row['path_code']} {row['path_name']}" if level == 1 else row["path_name"]
            value = row["path_code"] if level == 1 else row["path_name"]
            node = {
                "label": label,
                "value": value,
                "pathLabel": row["path_code"] if level == 1 else row["path_name"],
                "pathCode": row["path_code"],
                "pathName": row["path_name"],
                "dimensionCode": row["dimension_code"],
                "pathLevel": level,
                "fullPath": row.get("full_path") or "",
            }
            if row.get("remark"):
                node["remark"] = row["remark"]
            nodes_by_id[node_id] = node
            children_by_parent.setdefault(normalized_parent_id, []).append(node_id)
            if normalized_parent_id is None:
                root_ids.append(node_id)

        def build_tree(node_id):
            node = dict(nodes_by_id[node_id])
            child_ids = children_by_parent.get(node_id, [])
            if child_ids:
                node["children"] = [build_tree(child_id) for child_id in child_ids]
            return node

        tree = [build_tree(node_id) for node_id in root_ids]
        if not normalized_dimension:
            return tree

        def retain_matching_branches(node):
            node_dimension = str(node.get("dimensionCode") or "").strip().casefold()
            if node_dimension == normalized_dimension:
                return node

            filtered_children = []
            for child in node.get("children", []):
                filtered_child = retain_matching_branches(child)
                if filtered_child is not None:
                    filtered_children.append(filtered_child)
            if not filtered_children:
                return None

            filtered_node = {key: value for key, value in node.items() if key != "children"}
            filtered_node["children"] = filtered_children
            return filtered_node

        filtered_tree = []
        for root in tree:
            filtered_root = retain_matching_branches(root)
            if filtered_root is not None:
                filtered_tree.append(filtered_root)
        return filtered_tree


indicator_path_service = IndicatorPathService()
