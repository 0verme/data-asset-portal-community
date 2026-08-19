from __future__ import annotations

import os

from ..db.gaussdb import fetch_all, resolve_db_profile_name


TABLE_INDICATOR_PATH_CONFIG = "dwp.p_indicator_path_config"


class IndicatorPathDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "INDICATOR_PATH_DATA_SOURCE_ERROR", "message": self.message}


class IndicatorPathService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise IndicatorPathDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise IndicatorPathDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise IndicatorPathDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise IndicatorPathDataSourceError("数据库查询失败") from error
        return [dict(zip(columns, row)) for row in rows]

    def get_path_tree(self, dimension_code=None):
        where = [
            "status IN ('enabled', 'ENABLED', '启用')",
        ]
        if dimension_code:
            normalized = str(dimension_code).strip().upper()
            where.append(f"dimension_code = {self._quote(normalized)}")
        sql = f"""
SELECT
    id,
    parent_id,
    path_code,
    path_name,
    dimension_code,
    path_level,
    full_path,
    sort_order,
    status,
    remark
FROM {TABLE_INDICATOR_PATH_CONFIG}
WHERE {' AND '.join(where)}
ORDER BY path_level, COALESCE(parent_id, 0), sort_order, id
"""
        rows = self._fetch_rows(sql)

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

        return [build_tree(node_id) for node_id in root_ids]


indicator_path_service = IndicatorPathService()
