"""API asset metadata ledger backed by the public system master."""

from __future__ import annotations

import os
import re

from ..db.facade import database_transaction, execute_statements, fetch_all, resolve_db_profile_name
CODE_RE = re.compile(r"^[A-Z][A-Z0-9_-]{2,63}$")
TABLE = "dwp.p_api_asset"
SYSTEM_TABLE = "dwp.p_system"
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

    def _profile_name(self):
        return self._profile or resolve_db_profile_name()

    def _rows(self, sql, params=None):
        try:
            columns, rows = fetch_all(self._profile_name(), sql, params=params)
            return [dict(zip(columns, row)) for row in rows]
        except Exception as error:
            raise ApiAssetError(f"Database query failed: {error}") from error

    def _execute(self, statements):
        try:
            return execute_statements(self._profile_name(), statements)
        except Exception as error:
            raise ApiAssetError(f"Database execution failed: {error}") from error

    def _next(self, table, column):
        return int(self._rows(f"SELECT COALESCE(MAX({column}), 0) + 1 AS id FROM {table}")[0]["id"])

    def _exists(self, code):
        return bool(self._rows(f"SELECT api_code FROM {TABLE} WHERE api_code=? AND is_deleted='N'", [code]))

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
            systems = self._rows(
                f"SELECT system_id FROM {SYSTEM_TABLE} "
                "WHERE system_id=? AND is_deleted='N' AND status_code='enabled'",
                [item["systemId"]],
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
                value = {"name": name, "in": location, "dataType": dtype, "required": bool(row.get("required")), "description": str(row.get("description") or "").strip(), "example": str(row.get("example") or "").strip()}
            elif kind == "responseFields":
                name = str(row.get("name") or "").strip()
                dtype = str(row.get("dataType") or "").strip()
                key, valid = name, bool(name and dtype)
                value = {"name": name, "dataType": dtype, "description": str(row.get("description") or "").strip(), "example": str(row.get("example") or "").strip()}
            else:
                relation_type = str(row.get("type") or "").strip()
                code = str(row.get("targetCode") or "").strip()
                key, valid = (relation_type, code), relation_type in RELATION_TYPES and bool(code)
                value = {"type": relation_type, "targetCode": code, "targetName": str(row.get("targetName") or "").strip()}
            if not valid:
                errors.append({"field": f"{kind}[{index}]", "message": "required fields are invalid"})
            elif key not in seen:
                seen.add(key)
                normalized.append(value)
        if errors:
            raise ApiAssetValidationError("API asset validation failed", errors)
        return normalized

    def _item(self, row, params=None, fields=None, relations=None):
        code = row["api_code"]
        params = params if params is not None else self._rows(
            "SELECT param_name,param_in,data_type,required_flag,description_text,example_value "
            "FROM dwp.p_api_param WHERE api_code=? ORDER BY sort_no,param_pk", [code]
        )
        fields = fields if fields is not None else self._rows(
            "SELECT field_name,data_type,description_text,example_value "
            "FROM dwp.p_api_response_field WHERE api_code=? ORDER BY sort_no,field_pk", [code]
        )
        relations = relations if relations is not None else self._rows(
            "SELECT relation_type,target_code,target_name FROM dwp.p_api_relation "
            "WHERE api_code=? ORDER BY sort_no,relation_pk", [code]
        )
        system_id = row.get("system_id")
        system = None if system_id is None else {
            "id": system_id,
            "code": row.get("system_code") or "",
            "name": row.get("system_name") or "",
            "shortName": row.get("system_abbr") or "",
            "type": row.get("system_type") or "",
        }
        return {
            "code": code, "name": row["api_name"], "method": row["method_code"],
            "path": row["path_text"], "version": row.get("version_text") or "",
            "systemId": system_id, "system": system,
            # Deprecated response aliases preserve existing private frontend/API clients.
            "downstreamSystemId": system_id,
            "downstreamSystemName": row.get("system_name") or "",
            "downstreamSystemShortName": row.get("system_abbr") or "",
            "legacyPushSystemId": row.get("downstream_system_id"),
            "type": row.get("api_type") or "", "status": row["status_code"],
            "ownerDept": row["owner_dept_name"], "ownerName": row["owner_name"],
            "maintainerName": row.get("maintainer_name") or "",
            "description": row.get("description_text") or "", "remark": row.get("remark_desc") or "",
            "params": [{"name": p["param_name"], "in": p["param_in"], "dataType": p["data_type"], "required": p["required_flag"] == "Y", "description": p.get("description_text") or "", "example": p.get("example_value") or ""} for p in params],
            "responseFields": [{"name": f["field_name"], "dataType": f["data_type"], "description": f.get("description_text") or "", "example": f.get("example_value") or ""} for f in fields],
            "relations": [{"type": r["relation_type"], "targetCode": r["target_code"], "targetName": r.get("target_name") or ""} for r in relations],
            "updatedBy": row.get("updated_by") or "", "updatedAt": str(row.get("updated_at") or ""),
        }

    def _items(self, rows):
        codes = [row["api_code"] for row in rows]
        if not codes:
            return []
        placeholders = ",".join("?" for _ in codes)
        queries = (
            ("params", f"SELECT api_code,param_name,param_in,data_type,required_flag,description_text,example_value FROM dwp.p_api_param WHERE api_code IN ({placeholders}) ORDER BY api_code,sort_no,param_pk"),
            ("fields", f"SELECT api_code,field_name,data_type,description_text,example_value FROM dwp.p_api_response_field WHERE api_code IN ({placeholders}) ORDER BY api_code,sort_no,field_pk"),
            ("relations", f"SELECT api_code,relation_type,target_code,target_name FROM dwp.p_api_relation WHERE api_code IN ({placeholders}) ORDER BY api_code,sort_no,relation_pk"),
        )
        grouped = {name: {code: [] for code in codes} for name, _ in queries}
        for name, sql in queries:
            for child in self._rows(sql, codes):
                grouped[name][child["api_code"]].append(child)
        return [self._item(row, grouped["params"][row["api_code"]], grouped["fields"][row["api_code"]], grouped["relations"][row["api_code"]]) for row in rows]

    def get_assets(self, keyword=None, status=None, method=None, downstream_system_id=None):
        if status and status not in BINARY_STATUS_VALUES:
            raise ApiAssetValidationError("API asset validation failed", [{"field": "status", "message": "status is not allowed"}])
        where, params = ["a.is_deleted='N'"], []
        for column, value in (("status_code", status), ("method_code", method), ("system_id", downstream_system_id)):
            if value:
                where.append(f"a.{column}=?")
                params.append(value)
        with database_transaction():
            rows = self._rows(
                f"SELECT a.*,s.system_code,s.system_name,s.system_abbr,s.system_type FROM {TABLE} a "
                f"LEFT JOIN {SYSTEM_TABLE} s ON s.system_id=a.system_id AND s.is_deleted='N' "
                f"WHERE {' AND '.join(where)} ORDER BY a.api_code", params
            )
            items = self._items(rows)
        if keyword:
            query = keyword.strip().lower()
            items = [item for item in items if any(query in str(item[key]).lower() for key in ("code", "name", "path", "description", "ownerName", "ownerDept", "downstreamSystemName", "downstreamSystemShortName"))]
        return items

    def get_downstream_systems(self, keyword=None):
        query = str(keyword or "").strip().lower()
        condition = "1=1" if not query else "(LOWER(system_name) LIKE ? OR LOWER(system_abbr) LIKE ?)"
        params = [] if not query else [f"%{query}%", f"%{query}%"]
        return self._rows(
            f"SELECT system_id AS id,system_code AS code,system_name AS name,"
            f"system_abbr AS short_name,system_type AS type,status_code AS status "
            f"FROM {SYSTEM_TABLE} WHERE is_deleted='N' AND {condition} ORDER BY system_name",
            params,
        )

    def get_asset(self, code):
        rows = self._rows(
            f"SELECT a.*,s.system_code,s.system_name,s.system_abbr,s.system_type FROM {TABLE} a "
            f"LEFT JOIN {SYSTEM_TABLE} s ON s.system_id=a.system_id AND s.is_deleted='N' "
            "WHERE a.api_code=? AND a.is_deleted='N'", [str(code).strip().upper()]
        )
        if not rows:
            raise ApiAssetNotFoundError("API asset not found")
        return self._item(rows[0])

    def create(self, payload):
        item = self._validate_asset(payload)
        if self._exists(item["code"]):
            raise ApiAssetExistsError("API asset already exists")
        values = [self._next(TABLE, "api_pk"), item["code"], item["name"], item["method"], item["path"], item["version"], item["systemId"], item["type"], item["status"], item["ownerDept"], item["ownerName"], item["maintainerName"], item["description"], item["remark"]]
        columns = "api_pk,api_code,api_name,method_code,path_text,version_text,system_id,api_type,status_code,owner_dept_name,owner_name,maintainer_name,description_text,remark_desc"
        self._execute([(f"INSERT INTO {TABLE} ({columns}) VALUES ({','.join('?' for _ in values)})", values)])
        for key, kind in (("params", "params"), ("responseFields", "responseFields"), ("relations", "relations")):
            if key in payload:
                self.replace_rows(item["code"], payload[key], kind)
        return self.get_asset(item["code"])

    def update(self, code, payload):
        self.get_asset(code)
        item = self._validate_asset({**(payload or {}), "code": code})
        assignments = {"api_name": item["name"], "method_code": item["method"], "path_text": item["path"], "version_text": item["version"], "system_id": item["systemId"], "api_type": item["type"], "status_code": item["status"], "owner_dept_name": item["ownerDept"], "owner_name": item["ownerName"], "maintainer_name": item["maintainerName"], "description_text": item["description"], "remark_desc": item["remark"]}
        self._execute([(f"UPDATE {TABLE} SET {','.join(f'{key}=?' for key in assignments)},updated_at=CURRENT_TIMESTAMP WHERE api_code=?", [*assignments.values(), item["code"]])])
        for key, kind in (("params", "params"), ("responseFields", "responseFields"), ("relations", "relations")):
            if key in payload:
                self.replace_rows(item["code"], payload[key], kind)
        return self.get_asset(item["code"])

    def update_status(self, code, payload):
        self.get_asset(code)
        status = str((payload or {}).get("status") or "").strip()
        if status not in BINARY_STATUS_VALUES:
            raise ApiAssetValidationError("API asset validation failed", [{"field": "status", "message": "status is not allowed"}])
        self._execute([(f"UPDATE {TABLE} SET status_code=?,updated_at=CURRENT_TIMESTAMP WHERE api_code=?", [status, str(code).upper()])])
        return self.get_asset(code)

    def replace_rows(self, code, rows, kind):
        self.get_asset(code)
        values = self._validate_rows(rows, kind)
        code = str(code).strip().upper()
        table, pk_column = {"params": ("dwp.p_api_param", "param_pk"), "responseFields": ("dwp.p_api_response_field", "field_pk"), "relations": ("dwp.p_api_relation", "relation_pk")}[kind]
        statements = [(f"DELETE FROM {table} WHERE api_code=?", [code])]
        next_id = self._next(table, pk_column)
        for index, row in enumerate(values):
            if kind == "params":
                columns = "param_pk,api_code,param_name,param_in,data_type,required_flag,description_text,example_value,sort_no"
                data = [next_id + index, code, row["name"], row["in"], row["dataType"], "Y" if row["required"] else "N", row["description"], row["example"], index]
            elif kind == "responseFields":
                columns = "field_pk,api_code,field_name,data_type,description_text,example_value,sort_no"
                data = [next_id + index, code, row["name"], row["dataType"], row["description"], row["example"], index]
            else:
                columns = "relation_pk,api_code,relation_type,target_code,target_name,sort_no"
                data = [next_id + index, code, row["type"], row["targetCode"], row["targetName"], index]
            statements.append((f"INSERT INTO {table} ({columns}) VALUES ({','.join('?' for _ in data)})", data))
        self._execute(statements)
        return self.get_asset(code)

    def delete(self, code):
        self.get_asset(code)
        self._execute([(f"UPDATE {TABLE} SET is_deleted='Y',updated_at=CURRENT_TIMESTAMP WHERE api_code=?", [str(code).upper()])])


api_asset_service = ApiAssetService()
