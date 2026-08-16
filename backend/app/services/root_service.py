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

from __future__ import annotations

import json
import os
import re
from uuid import uuid4
from copy import deepcopy

from ..db.gaussdb import execute_statements, fetch_all, resolve_db_profile_name
from ..settings import get_default_operator
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_IMPORT,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


ROOT_ABBR_RE = re.compile(r"^[a-z0-9]+$")
TABLE_ROOT_CATEGORY = "dwp.p_root_category"
TABLE_ROOT_ITEM = "dwp.p_root_item"
TABLE_ROOT_CHANGE_LOG = "dwp.p_root_change_log"


class RootNotFoundError(Exception):
    def __init__(self, abbr):
        self.abbr = abbr
        super().__init__(f"Root not found: {abbr}")

    def to_dict(self):
        return {"code": "ROOT_NOT_FOUND", "message": f"Root not found: {self.abbr}"}


class RootAlreadyExistsError(Exception):
    def __init__(self, abbr):
        self.abbr = abbr
        super().__init__(f"Root already exists: {abbr}")

    def to_dict(self):
        return {"code": "ROOT_ALREADY_EXISTS", "message": f"Root already exists: {self.abbr}"}


class RootValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("Root validation failed")

    def to_dict(self):
        return {"code": "ROOT_VALIDATION_FAILED", "message": "Root validation failed", "details": self.details}


class RootDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "ROOT_DATA_SOURCE_ERROR", "message": self.message}


class RootService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_operator = get_default_operator()

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise RootDataSourceError(f"Database config file not found: {error.filename}") from error
        except KeyError as error:
            raise RootDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise RootDataSourceError(str(error)) from error
        except Exception as error:
            raise RootDataSourceError(f"Database query failed: {error}") from error
        return [dict(zip(columns, row)) for row in rows]

    def _execute(self, statements):
        try:
            return execute_statements(self._db_profile or resolve_db_profile_name(), statements)
        except FileNotFoundError as error:
            raise RootDataSourceError(f"Database config file not found: {error.filename}") from error
        except KeyError as error:
            raise RootDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise RootDataSourceError(str(error)) from error
        except Exception as error:
            raise RootDataSourceError(f"Database execution failed: {error}") from error

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _next_id(self, table_name, id_column):
        rows = self._fetch_rows(f"SELECT COALESCE(MAX({id_column}), 0) + 1 AS next_id FROM {table_name}")
        return int(rows[0]["next_id"])

    def _normalize_payload(self, payload):
        details = []
        if not isinstance(payload, dict):
            raise RootValidationError([{"field": "body", "message": "Request body must be a JSON object"}])

        abbr = str(payload.get("abbr") or "").strip()
        cn = str(payload.get("cn") or "").strip()
        cat = str(payload.get("cat") or "").strip()

        if not abbr:
            details.append({"field": "abbr", "message": "abbr is required"})
        elif not ROOT_ABBR_RE.fullmatch(abbr):
            details.append({"field": "abbr", "message": "abbr must contain only lowercase letters and numbers; underscore is not allowed"})
        if not cn:
            details.append({"field": "cn", "message": "cn is required"})
        if not cat:
            details.append({"field": "cat", "message": "cat is required"})

        if details:
            raise RootValidationError(details)

        return {
            "abbr": abbr,
            "en": str(payload.get("en") or "").strip(),
            "cn": cn,
            "cat": cat,
            "desc": str(payload.get("desc") or "").strip(),
        }

    def _normalize_items(self, items):
        if not isinstance(items, list) or not items:
            raise RootValidationError([{"field": "items", "message": "items must contain at least one record"}])
        return [self._normalize_payload(item) for item in items]

    def _db_categories(self):
        sql = f"""
SELECT
    c.category_name,
    COALESCE(t.item_count, 0) AS item_count
FROM {TABLE_ROOT_CATEGORY} c
LEFT JOIN (
    SELECT category_name, COUNT(1) AS item_count
    FROM {TABLE_ROOT_ITEM}
    WHERE is_deleted = 'N'
    GROUP BY category_name
) t
  ON c.category_name = t.category_name
WHERE c.is_deleted = 'N'
ORDER BY c.display_order, c.category_name
"""
        return [{"name": row["category_name"], "count": int(row["item_count"] or 0)} for row in self._fetch_rows(sql)]

    def _db_items(self, keyword=None, cat=None):
        where = ["is_deleted = 'N'"]
        if cat:
            where.append(f"category_name = {self._quote(cat)}")
        sql = f"""
SELECT root_id, root_abbr, root_en_name, root_cn_name, category_name, root_desc
FROM {TABLE_ROOT_ITEM}
WHERE {' AND '.join(where)}
ORDER BY root_abbr
"""
        rows = self._fetch_rows(sql)
        items = [{
            "abbr": row["root_abbr"],
            "en": row.get("root_en_name") or "",
            "cn": row["root_cn_name"],
            "cat": row["category_name"],
            "desc": row.get("root_desc") or "",
        } for row in rows]
        if keyword:
            query = keyword.strip().lower()
            items = [item for item in items if any(query in str(item[key]).lower() for key in ("abbr", "en", "cn", "desc"))]
        return items

    def get_roots(self, keyword=None, cat=None):
        return self._db_items(keyword=keyword, cat=cat)

    def get_root_categories(self):
        return self._db_categories()

    def get_root_detail(self, abbr):
        item = next((root for root in self.get_roots() if root["abbr"] == abbr), None)
        if not item:
            raise RootNotFoundError(abbr)
        return deepcopy(item)

    def create_root(self, payload):
        with operation_log_service.audit(
            module_name="词根管理",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("abbr") or "") if isinstance(payload, dict) else "",
            operation_desc="新增词根",
        ) as audit:
            item = self._create_root(payload)
            audit.operation_object = item["abbr"]
            audit.after = item
            return item

    def _create_root(self, payload):
        item = self._normalize_payload(payload)
        if any(current["abbr"] == item["abbr"] for current in self.get_roots()):
            raise RootAlreadyExistsError(item["abbr"])

        root_id = self._next_id(TABLE_ROOT_ITEM, "root_id")
        change_id = self._next_id(TABLE_ROOT_CHANGE_LOG, "change_id")
        statements = [
            f"""
INSERT INTO {TABLE_ROOT_ITEM} (
  root_id, root_abbr, root_en_name, root_cn_name, category_name, root_desc, created_by, updated_by
) VALUES (
  {root_id}, {self._quote(item['abbr'])}, {self._quote(item['en'])}, {self._quote(item['cn'])},
  {self._quote(item['cat'])}, {self._quote(item['desc'])}, {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip(),
            f"""
INSERT INTO {TABLE_ROOT_CHANGE_LOG} (
  change_id, root_id, root_abbr, change_type, change_summary, after_json, operator_name
) VALUES (
  {change_id}, {root_id}, {self._quote(item['abbr'])}, 'CREATE_ROOT', 'create root',
  {self._quote(json.dumps(item, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return item

    def update_root(self, abbr, payload):
        with operation_log_service.audit(
            module_name="词根管理",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=abbr,
            operation_desc="编辑词根",
        ) as audit:
            current, item = self._update_root(abbr, payload)
            audit.operation_object = item["abbr"]
            audit.before = current
            audit.after = item
            return item

    def _update_root(self, abbr, payload):
        item = self._normalize_payload(payload)
        rows = self._fetch_rows(f"SELECT root_id FROM {TABLE_ROOT_ITEM} WHERE root_abbr = {self._quote(abbr)} AND is_deleted = 'N'")
        if not rows:
            raise RootNotFoundError(abbr)
        if item["abbr"] != abbr and any(root["abbr"] == item["abbr"] for root in self.get_roots()):
            raise RootAlreadyExistsError(item["abbr"])

        current = self.get_root_detail(abbr)
        root_id = int(rows[0]["root_id"])
        change_id = self._next_id(TABLE_ROOT_CHANGE_LOG, "change_id")
        statements = [
            f"""
UPDATE {TABLE_ROOT_ITEM}
SET
  root_abbr = {self._quote(item['abbr'])},
  root_en_name = {self._quote(item['en'])},
  root_cn_name = {self._quote(item['cn'])},
  category_name = {self._quote(item['cat'])},
  root_desc = {self._quote(item['desc'])},
  updated_by = {self._quote(self._default_operator)},
  updated_at = CURRENT_TIMESTAMP
WHERE root_id = {root_id}
""".strip(),
            f"""
INSERT INTO {TABLE_ROOT_CHANGE_LOG} (
  change_id, root_id, root_abbr, change_type, change_summary, before_json, after_json, operator_name
) VALUES (
  {change_id}, {root_id}, {self._quote(item['abbr'])}, 'UPDATE_ROOT', 'update root',
  {self._quote(json.dumps(current, ensure_ascii=False))},
  {self._quote(json.dumps(item, ensure_ascii=False))},
  {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return current, item

    def delete_root(self, abbr):
        with operation_log_service.audit(
            module_name="词根管理",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=abbr,
            operation_desc="删除词根",
        ) as audit:
            current = self._delete_root(abbr)
            audit.before = current

    def _delete_root(self, abbr):
        rows = self._fetch_rows(f"SELECT root_id FROM {TABLE_ROOT_ITEM} WHERE root_abbr = {self._quote(abbr)} AND is_deleted = 'N'")
        if not rows:
            raise RootNotFoundError(abbr)
        current = self.get_root_detail(abbr)
        root_id = int(rows[0]["root_id"])
        change_id = self._next_id(TABLE_ROOT_CHANGE_LOG, "change_id")
        statements = [
            f"""
UPDATE {TABLE_ROOT_ITEM}
SET is_deleted = 'Y', updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP
WHERE root_id = {root_id}
""".strip(),
            f"""
INSERT INTO {TABLE_ROOT_CHANGE_LOG} (
  change_id, root_id, root_abbr, change_type, change_summary, before_json, operator_name
) VALUES (
  {change_id}, {root_id}, {self._quote(abbr)}, 'DELETE_ROOT', 'delete root',
  {self._quote(json.dumps(current, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return current

    def import_roots(self, payload):
        items = self._normalize_items(payload.get("items") if isinstance(payload, dict) else None)
        batch_id = uuid4().hex
        with operation_log_service.batch_audit(
            batch_id=batch_id,
            resource_type="root",
            operation=OPERATION_TYPE_IMPORT,
            total_count=len(items),
            summary="root import",
        ) as audit:
            current = {item["abbr"]: item for item in self.get_roots()}
            inserted = 0
            updated = 0
            for item in items:
                if item["abbr"] in current:
                    self._update_root(item["abbr"], item)
                    updated += 1
                else:
                    self._create_root(item)
                    inserted += 1
            audit.success_count = inserted + updated
            audit.created_count = inserted
            audit.updated_count = updated
            return {"inserted": inserted, "updated": updated, "items": self.get_roots()}


root_service = RootService()
