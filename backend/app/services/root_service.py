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
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import and_, func, insert, or_, select, update

from ..application import AuditActorMixin, actor_aware
from ..db.service import CoreAccess
from ..db.tables import root_category, root_change_log, root_item
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_IMPORT,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


ROOT_ABBR_RE = re.compile(r"^[a-z0-9]+$")


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


class RootService(AuditActorMixin):
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=RootDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _execute(self, statements):
        return self._db.execute_statements(statements)

    def _next_id(self, table, column):
        return self._db.next_pk(table, column)

    @staticmethod
    def _row_int(rows, key):
        try:
            return int(rows[0][key])
        except (IndexError, KeyError, TypeError, ValueError) as error:
            raise RootDataSourceError("数据库查询失败") from error

    @staticmethod
    def _columns():
        return (
            root_item.c.root_id,
            root_item.c.root_abbr,
            root_item.c.root_en_name,
            root_item.c.root_cn_name,
            root_item.c.category_name,
            root_item.c.root_desc,
        )

    @staticmethod
    def _row_to_item(row):
        return {
            "abbr": row["root_abbr"],
            "en": row.get("root_en_name") or "",
            "cn": row["root_cn_name"],
            "cat": row["category_name"],
            "desc": row.get("root_desc") or "",
        }

    @staticmethod
    def _build_item_filters(keyword=None, cat=None):
        clauses = [root_item.c.is_deleted == "N"]
        if cat:
            clauses.append(root_item.c.category_name == str(cat).strip())
        if keyword:
            escaped = str(keyword).strip().lower().replace("\\", "\\\\")
            escaped = escaped.replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            searchable = (
                root_item.c.root_abbr,
                root_item.c.root_en_name,
                root_item.c.root_cn_name,
                root_item.c.root_desc,
            )
            clauses.append(
                or_(
                    *(
                        func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                        for column in searchable
                    )
                )
            )
        return clauses

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
        item_counts = (
            select(
                root_item.c.category_name,
                func.count(root_item.c.root_id).label("item_count"),
            )
            .where(root_item.c.is_deleted == "N")
            .group_by(root_item.c.category_name)
            .subquery()
        )
        statement = (
            select(
                root_category.c.category_name,
                func.coalesce(item_counts.c.item_count, 0).label("item_count"),
            )
            .outerjoin(item_counts, root_category.c.category_name == item_counts.c.category_name)
            .where(root_category.c.is_deleted == "N")
            .order_by(root_category.c.display_order, root_category.c.category_name)
        )
        return [
            {"name": row["category_name"], "count": int(row["item_count"] or 0)}
            for row in self._fetch_rows(statement)
        ]

    def _db_items(self, keyword=None, cat=None):
        statement = (
            select(*self._columns())
            .where(*self._build_item_filters(keyword=keyword, cat=cat))
            .order_by(root_item.c.root_abbr)
        )
        return [self._row_to_item(row) for row in self._fetch_rows(statement)]

    def get_roots(self, keyword=None, cat=None):
        return self._db_items(keyword=keyword, cat=cat)

    def get_root_categories(self):
        return self._db_categories()

    def get_root_detail(self, abbr):
        statement = select(*self._columns()).where(
            and_(root_item.c.root_abbr == abbr, root_item.c.is_deleted == "N")
        )
        rows = self._fetch_rows(statement)
        if not rows:
            raise RootNotFoundError(abbr)
        return deepcopy(self._row_to_item(rows[0]))

    def _insert_item(self, item, root_id):
        return insert(root_item).values(
            root_id=root_id,
            root_abbr=item["abbr"],
            root_en_name=item["en"],
            root_cn_name=item["cn"],
            category_name=item["cat"],
            root_desc=item["desc"],
            is_deleted="N",
            created_by=self._default_operator,
            updated_by=self._default_operator,
        )

    def _insert_change_log(self, *, change_id, root_id, root_abbr, change_type, before=None, after=None):
        return insert(root_change_log).values(
            change_id=change_id,
            root_id=root_id,
            root_abbr=root_abbr,
            change_type=change_type,
            change_summary={
                "CREATE_ROOT": "create root",
                "UPDATE_ROOT": "update root",
                "DELETE_ROOT": "delete root",
            }[change_type],
            before_json=json.dumps(before, ensure_ascii=False) if before is not None else None,
            after_json=json.dumps(after, ensure_ascii=False) if after is not None else None,
            operator_name=self._default_operator,
        )

    @actor_aware
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

        root_id = self._next_id(root_item, root_item.c.root_id)
        change_id = self._next_id(root_change_log, root_change_log.c.change_id)
        self._execute(
            [
                self._insert_item(item, root_id),
                self._insert_change_log(
                    change_id=change_id,
                    root_id=root_id,
                    root_abbr=item["abbr"],
                    change_type="CREATE_ROOT",
                    after=item,
                ),
            ]
        )
        return item

    @actor_aware
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
        rows = self._fetch_rows(
            select(root_item.c.root_id).where(
                and_(root_item.c.root_abbr == abbr, root_item.c.is_deleted == "N")
            )
        )
        if not rows:
            raise RootNotFoundError(abbr)
        if item["abbr"] != abbr and any(current["abbr"] == item["abbr"] for current in self.get_roots()):
            raise RootAlreadyExistsError(item["abbr"])

        current = self.get_root_detail(abbr)
        root_id = self._row_int(rows, "root_id")
        change_id = self._next_id(root_change_log, root_change_log.c.change_id)
        self._execute(
            [
                update(root_item)
                .where(root_item.c.root_id == root_id)
                .values(
                    root_abbr=item["abbr"],
                    root_en_name=item["en"],
                    root_cn_name=item["cn"],
                    category_name=item["cat"],
                    root_desc=item["desc"],
                    updated_by=self._default_operator,
                    updated_at=func.current_timestamp(),
                ),
                self._insert_change_log(
                    change_id=change_id,
                    root_id=root_id,
                    root_abbr=item["abbr"],
                    change_type="UPDATE_ROOT",
                    before=current,
                    after=item,
                ),
            ]
        )
        return current, item

    @actor_aware
    def delete_root(self, abbr):
        with operation_log_service.audit(
            module_name="词根管理",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=abbr,
            operation_desc="删除词根",
        ) as audit:
            audit.before = self._delete_root(abbr)

    def _delete_root(self, abbr):
        rows = self._fetch_rows(
            select(root_item.c.root_id).where(
                and_(root_item.c.root_abbr == abbr, root_item.c.is_deleted == "N")
            )
        )
        if not rows:
            raise RootNotFoundError(abbr)
        current = self.get_root_detail(abbr)
        root_id = self._row_int(rows, "root_id")
        change_id = self._next_id(root_change_log, root_change_log.c.change_id)
        self._execute(
            [
                update(root_item)
                .where(root_item.c.root_id == root_id)
                .values(
                    is_deleted="Y",
                    updated_by=self._default_operator,
                    updated_at=func.current_timestamp(),
                ),
                self._insert_change_log(
                    change_id=change_id,
                    root_id=root_id,
                    root_abbr=abbr,
                    change_type="DELETE_ROOT",
                    before=current,
                ),
            ]
        )
        return current

    @actor_aware
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
