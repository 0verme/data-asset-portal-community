"""API asset metadata ledger backed by the public system master."""

from __future__ import annotations

import os
import re

from sqlalchemy import and_, delete, func, insert, or_, select, update

from ..db.service import CoreAccess
from ..db.tables import (
    api_asset,
    api_param,
    api_relation,
    api_response_field,
    system_table,
)


CODE_RE = re.compile(r"^[A-Z][A-Z0-9_-]{2,63}$")
METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
RELATION_TYPES = {"table", "indicator", "system"}
BINARY_STATUS_VALUES = {"enabled", "disabled"}


class ApiAssetError(Exception):
    status = 500
    code = "API_ASSET_DATA_SOURCE_ERROR"

    def __init__(self, message, details=None):
        self.message, self.details = message, details or []

    def to_dict(self):
        data = {"code": self.code, "message": self.message}
        if self.details:
            data["details"] = self.details
        return data


class ApiAssetNotFoundError(ApiAssetError):
    status, code = 404, "API_ASSET_NOT_FOUND"


class ApiAssetExistsError(ApiAssetError):
    status, code = 409, "API_ASSET_ALREADY_EXISTS"


class ApiAssetValidationError(ApiAssetError):
    status, code = 422, "API_ASSET_VALIDATION_FAILED"


class ApiAssetService:
    def __init__(self):
        self._profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._profile,
            error_factory=ApiAssetError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _execute(self, statements):
        return self._db.execute_statements(statements)

    def _next(self, table, column):
        return self._db.next_pk(table, column)

    @staticmethod
    def _asset_columns():
        return (
            api_asset.c.api_pk,
            api_asset.c.api_code,
            api_asset.c.api_name,
            api_asset.c.method_code,
            api_asset.c.path_text,
            api_asset.c.version_text,
            api_asset.c.system_id,
            api_asset.c.downstream_system_id,
            api_asset.c.api_type,
            api_asset.c.status_code,
            api_asset.c.owner_dept_name,
            api_asset.c.owner_name,
            api_asset.c.maintainer_name,
            api_asset.c.description_text,
            api_asset.c.remark_desc,
            api_asset.c.updated_by,
            api_asset.c.updated_at,
            system_table.c.system_code,
            system_table.c.system_name,
            system_table.c.system_abbr,
            system_table.c.system_type,
        )

    def _exists(self, code):
        statement = select(api_asset.c.api_code).where(
            and_(api_asset.c.api_code == code, api_asset.c.is_deleted == "N")
        )
        return bool(self._fetch_rows(statement))

    def _validate_asset(self, payload, include_code=True):
        if not isinstance(payload, dict):
            raise ApiAssetValidationError(
                "Request body must be a JSON object",
                [{"field": "body", "message": "must be object"}],
            )
        item = {
            "code": str(payload.get("code") or "").strip().upper(),
            "name": str(payload.get("name") or "").strip(),
            "method": str(payload.get("method") or "").strip().upper(),
            "path": str(payload.get("path") or "").strip(),
            "version": str(payload.get("version") or "").strip(),
            # downstreamSystemId remains an accepted request alias during migration.
            "systemId": payload.get("systemId", payload.get("downstreamSystemId")),
            "type": str(payload.get("type") or "").strip(),
            "status": str(payload.get("status", "enabled")).strip(),
            "ownerDept": str(payload.get("ownerDept") or "").strip(),
            "ownerName": str(payload.get("ownerName") or "").strip(),
            "maintainerName": str(payload.get("maintainerName") or "").strip(),
            "description": str(payload.get("description") or "").strip(),
            "remark": str(payload.get("remark") or "").strip(),
        }
        errors = []
        if include_code and not CODE_RE.fullmatch(item["code"]):
            errors.append({"field": "code", "message": "code format is invalid"})
        if not item["name"]:
            errors.append({"field": "name", "message": "name is required"})
        if item["method"] not in METHODS:
            errors.append({"field": "method", "message": "method is not allowed"})
        if not item["path"].startswith("/"):
            errors.append({"field": "path", "message": "path must start with /"})
        if item["status"] not in BINARY_STATUS_VALUES:
            errors.append({"field": "status", "message": "status is not allowed"})
        for key in ("ownerDept", "ownerName"):
            if not item[key]:
                errors.append({"field": key, "message": f"{key} is required"})
        try:
            item["systemId"] = int(item["systemId"])
        except (TypeError, ValueError):
            errors.append({"field": "systemId", "message": "请选择业务系统"})
        if isinstance(item["systemId"], int):
            systems = self._fetch_rows(
                select(system_table.c.system_id).where(
                    and_(
                        system_table.c.system_id == item["systemId"],
                        system_table.c.is_deleted == "N",
                        system_table.c.status_code == "enabled",
                    )
                )
            )
            if not systems:
                errors.append({"field": "systemId", "message": "业务系统不存在或未启用"})
        if errors:
            raise ApiAssetValidationError("API asset validation failed", errors)
        return item

    def _validate_rows(self, rows, kind):
        if not isinstance(rows, list):
            raise ApiAssetValidationError(
                f"{kind} must be an array", [{"field": kind, "message": "must be array"}]
            )
        normalized, seen, errors = [], set(), []
        for index, raw in enumerate(rows):
            row = raw if isinstance(raw, dict) else {}
            if kind == "params":
                name = str(row.get("name") or "").strip()
                location = str(row.get("in") or "").strip()
                dtype = str(row.get("dataType") or "").strip()
                key, valid = (name, location), bool(name and location in {"query", "path", "header", "body"} and dtype)
                value = {
                    "name": name,
                    "in": location,
                    "dataType": dtype,
                    "required": bool(row.get("required")),
                    "description": str(row.get("description") or "").strip(),
                    "example": str(row.get("example") or "").strip(),
                }
            elif kind == "responseFields":
                name = str(row.get("name") or "").strip()
                dtype = str(row.get("dataType") or "").strip()
                key, valid = name, bool(name and dtype)
                value = {
                    "name": name,
                    "dataType": dtype,
                    "description": str(row.get("description") or "").strip(),
                    "example": str(row.get("example") or "").strip(),
                }
            else:
                relation_type = str(row.get("type") or "").strip()
                code = str(row.get("targetCode") or "").strip()
                key, valid = (relation_type, code), relation_type in RELATION_TYPES and bool(code)
                value = {
                    "type": relation_type,
                    "targetCode": code,
                    "targetName": str(row.get("targetName") or "").strip(),
                }
            if not valid:
                errors.append({"field": f"{kind}[{index}]", "message": "required fields are invalid"})
            elif key not in seen:
                seen.add(key)
                normalized.append(value)
        if errors:
            raise ApiAssetValidationError("API asset validation failed", errors)
        return normalized

    def _child_rows(self, table, code_column, code):
        return self._fetch_rows(
            select(*table.c).where(table.c.api_code == code).order_by(table.c.sort_no, code_column)
        )

    def _item(self, row, params=None, fields=None, relations=None):
        code = row["api_code"]
        params = params if params is not None else self._child_rows(api_param, api_param.c.param_pk, code)
        fields = fields if fields is not None else self._child_rows(api_response_field, api_response_field.c.field_pk, code)
        relations = relations if relations is not None else self._child_rows(api_relation, api_relation.c.relation_pk, code)
        system_id = row.get("system_id")
        system = None if system_id is None else {
            "id": system_id,
            "code": row.get("system_code") or "",
            "name": row.get("system_name") or "",
            "shortName": row.get("system_abbr") or "",
            "type": row.get("system_type") or "",
        }
        return {
            "code": code,
            "name": row["api_name"],
            "method": row["method_code"],
            "path": row["path_text"],
            "version": row.get("version_text") or "",
            "systemId": system_id,
            "system": system,
            # Deprecated response aliases preserve existing private frontend/API clients.
            "downstreamSystemId": system_id,
            "downstreamSystemName": row.get("system_name") or "",
            "downstreamSystemShortName": row.get("system_abbr") or "",
            "legacyPushSystemId": row.get("downstream_system_id"),
            "type": row.get("api_type") or "",
            "status": row["status_code"],
            "ownerDept": row["owner_dept_name"],
            "ownerName": row["owner_name"],
            "maintainerName": row.get("maintainer_name") or "",
            "description": row.get("description_text") or "",
            "remark": row.get("remark_desc") or "",
            "params": [
                {
                    "name": p["param_name"],
                    "in": p["param_in"],
                    "dataType": p["data_type"],
                    "required": p["required_flag"] == "Y",
                    "description": p.get("description_text") or "",
                    "example": p.get("example_value") or "",
                }
                for p in params
            ],
            "responseFields": [
                {
                    "name": f["field_name"],
                    "dataType": f["data_type"],
                    "description": f.get("description_text") or "",
                    "example": f.get("example_value") or "",
                }
                for f in fields
            ],
            "relations": [
                {
                    "type": r["relation_type"],
                    "targetCode": r["target_code"],
                    "targetName": r.get("target_name") or "",
                }
                for r in relations
            ],
            "updatedBy": row.get("updated_by") or "",
            "updatedAt": str(row.get("updated_at") or ""),
        }

    def _items(self, rows):
        codes = [row["api_code"] for row in rows]
        if not codes:
            return []
        child_specs = (
            ("params", api_param, api_param.c.param_pk),
            ("fields", api_response_field, api_response_field.c.field_pk),
            ("relations", api_relation, api_relation.c.relation_pk),
        )
        grouped = {name: {code: [] for code in codes} for name, _, _ in child_specs}
        for name, table, order_column in child_specs:
            statement = (
                select(*table.c)
                .where(table.c.api_code.in_(codes))
                .order_by(table.c.api_code, table.c.sort_no, order_column)
            )
            for child in self._fetch_rows(statement):
                grouped[name][child["api_code"]].append(child)
        return [
            self._item(
                row,
                grouped["params"][row["api_code"]],
                grouped["fields"][row["api_code"]],
                grouped["relations"][row["api_code"]],
            )
            for row in rows
        ]

    @staticmethod
    def _search_clause(keyword):
        escaped = str(keyword).strip().lower().replace("\\", "\\\\")
        escaped = escaped.replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        searchable = (
            api_asset.c.api_code,
            api_asset.c.api_name,
            api_asset.c.path_text,
            api_asset.c.description_text,
            api_asset.c.owner_name,
            api_asset.c.owner_dept_name,
            system_table.c.system_name,
            system_table.c.system_abbr,
        )
        return or_(*(
            func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
            for column in searchable
        ))

    def _asset_statement(self, keyword=None, status=None, method=None, downstream_system_id=None):
        clauses = [api_asset.c.is_deleted == "N"]
        if status:
            clauses.append(api_asset.c.status_code == status)
        if method:
            clauses.append(api_asset.c.method_code == method)
        if downstream_system_id:
            clauses.append(api_asset.c.system_id == downstream_system_id)
        if keyword:
            clauses.append(self._search_clause(keyword))
        return (
            select(*self._asset_columns())
            .select_from(
                api_asset.outerjoin(
                    system_table,
                    and_(system_table.c.system_id == api_asset.c.system_id, system_table.c.is_deleted == "N"),
                )
            )
            .where(*clauses)
            .order_by(api_asset.c.api_code)
        )

    def get_assets(self, keyword=None, status=None, method=None, downstream_system_id=None):
        if status and status not in BINARY_STATUS_VALUES:
            raise ApiAssetValidationError(
                "API asset validation failed",
                [{"field": "status", "message": "status is not allowed"}],
            )
        return self._items(self._fetch_rows(self._asset_statement(keyword, status, method, downstream_system_id)))

    def get_downstream_systems(self, keyword=None):
        clauses = [system_table.c.is_deleted == "N"]
        if keyword:
            escaped = str(keyword).strip().lower().replace("\\", "\\\\")
            escaped = escaped.replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            clauses.append(or_(
                func.lower(system_table.c.system_name).like(pattern, escape="\\"),
                func.lower(system_table.c.system_abbr).like(pattern, escape="\\"),
            ))
        statement = (
            select(
                system_table.c.system_id.label("id"),
                system_table.c.system_code.label("code"),
                system_table.c.system_name.label("name"),
                system_table.c.system_abbr.label("short_name"),
                system_table.c.system_type.label("type"),
                system_table.c.status_code.label("status"),
            )
            .where(*clauses)
            .order_by(system_table.c.system_name)
        )
        return self._fetch_rows(statement)

    def get_asset(self, code):
        normalized_code = str(code).strip().upper()
        rows = self._fetch_rows(
            self._asset_statement()
            .where(api_asset.c.api_code == normalized_code)
        )
        if not rows:
            raise ApiAssetNotFoundError("API asset not found")
        return self._item(rows[0])

    def _insert_asset(self, item, api_pk):
        return insert(api_asset).values(
            api_pk=api_pk,
            api_code=item["code"],
            api_name=item["name"],
            method_code=item["method"],
            path_text=item["path"],
            version_text=item["version"],
            system_id=item["systemId"],
            api_type=item["type"],
            status_code=item["status"],
            owner_dept_name=item["ownerDept"],
            owner_name=item["ownerName"],
            maintainer_name=item["maintainerName"],
            description_text=item["description"],
            remark_desc=item["remark"],
            is_deleted="N",
        )

    def create(self, payload):
        item = self._validate_asset(payload)
        if self._exists(item["code"]):
            raise ApiAssetExistsError("API asset already exists")
        self._execute([self._insert_asset(item, self._next(api_asset, api_asset.c.api_pk))])
        for key, kind in (("params", "params"), ("responseFields", "responseFields"), ("relations", "relations")):
            if key in payload:
                self.replace_rows(item["code"], payload[key], kind)
        return self.get_asset(item["code"])

    def update(self, code, payload):
        self.get_asset(code)
        item = self._validate_asset({**(payload or {}), "code": code})
        assignments = {
            "api_name": item["name"],
            "method_code": item["method"],
            "path_text": item["path"],
            "version_text": item["version"],
            "system_id": item["systemId"],
            "api_type": item["type"],
            "status_code": item["status"],
            "owner_dept_name": item["ownerDept"],
            "owner_name": item["ownerName"],
            "maintainer_name": item["maintainerName"],
            "description_text": item["description"],
            "remark_desc": item["remark"],
        }
        self._execute([
            update(api_asset)
            .where(api_asset.c.api_code == item["code"])
            .values(**assignments, updated_at=func.current_timestamp())
        ])
        for key, kind in (("params", "params"), ("responseFields", "responseFields"), ("relations", "relations")):
            if key in payload:
                self.replace_rows(item["code"], payload[key], kind)
        return self.get_asset(item["code"])

    @staticmethod
    def _build_status_statement(code, status):
        return update(api_asset).where(api_asset.c.api_code == str(code).upper()).values(
            status_code=status,
            updated_at=func.current_timestamp(),
        )

    @staticmethod
    def _build_delete_statement(code):
        return update(api_asset).where(api_asset.c.api_code == str(code).upper()).values(
            is_deleted="Y",
            updated_at=func.current_timestamp(),
        )

    def update_status(self, code, payload):
        self.get_asset(code)
        status = str((payload or {}).get("status") or "").strip()
        if status not in BINARY_STATUS_VALUES:
            raise ApiAssetValidationError(
                "API asset validation failed",
                [{"field": "status", "message": "status is not allowed"}],
            )
        self._execute([self._build_status_statement(code, status)])
        return self.get_asset(code)

    def replace_rows(self, code, rows, kind):
        self.get_asset(code)
        values = self._validate_rows(rows, kind)
        code = str(code).strip().upper()
        tables = {
            "params": (api_param, api_param.c.param_pk),
            "responseFields": (api_response_field, api_response_field.c.field_pk),
            "relations": (api_relation, api_relation.c.relation_pk),
        }
        table, pk_column = tables[kind]
        statements = [delete(table).where(table.c.api_code == code)]
        next_id = self._next(table, pk_column)
        for index, row in enumerate(values):
            if kind == "params":
                statements.append(insert(table).values(
                    param_pk=next_id + index,
                    api_code=code,
                    param_name=row["name"],
                    param_in=row["in"],
                    data_type=row["dataType"],
                    required_flag="Y" if row["required"] else "N",
                    description_text=row["description"],
                    example_value=row["example"],
                    sort_no=index,
                ))
            elif kind == "responseFields":
                statements.append(insert(table).values(
                    field_pk=next_id + index,
                    api_code=code,
                    field_name=row["name"],
                    data_type=row["dataType"],
                    description_text=row["description"],
                    example_value=row["example"],
                    sort_no=index,
                ))
            else:
                statements.append(insert(table).values(
                    relation_pk=next_id + index,
                    api_code=code,
                    relation_type=row["type"],
                    target_code=row["targetCode"],
                    target_name=row["targetName"],
                    sort_no=index,
                ))
        self._execute(statements)
        return self.get_asset(code)

    def delete(self, code):
        self.get_asset(code)
        self._execute([self._build_delete_statement(code)])


api_asset_service = ApiAssetService()
