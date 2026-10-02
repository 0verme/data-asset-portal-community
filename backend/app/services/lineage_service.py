"""Controlled lineage POC data contract.

The daily collector will replace this in-memory snapshot.  The portal owns the
contract and graph traversal; renderers only receive the resulting subgraph.
"""

# pyright: reportMissingImports=false

from __future__ import annotations

from collections import deque
from copy import deepcopy
import hashlib
import json
import logging
import os

from sqlalchemy import select

from ..db.facade import database_transaction, get_db_profile
from ..db.registry import get_provider
from ..db.service import CoreAccess
from ..db.tables import lineage_edge, lineage_node, lineage_snapshot
from ..settings import get_runtime_environment
from .lineage_database_reader import LineageDatabaseReader


LOGGER = logging.getLogger(__name__)
LINEAGE_PROFILE_ENV = "LINEAGE_DB_PROFILE"
POC_ENVIRONMENTS = {"development", "dev", "test"}
LINEAGE_SEARCH_DEFAULT_LIMIT = 100
LINEAGE_SEARCH_MAX_LIMIT = 300
MAX_LINEAGE_SUBGRAPH_EDGE_ROWS = 10_000
LINEAGE_SUBGRAPH_EDGE_READS_PER_NODE = 16
MAX_LINEAGE_TABLE_VIEW_TASKS = 800
MAX_LINEAGE_TABLE_PROJECTION_PAIRS = 20_000

SNAPSHOT = {
    "snapshotId": "poc-20260712-001",
    "generatedAt": "2026-07-12T02:00:00Z",
    "generator": {"name": "portal-controlled-poc", "version": "1.0"},
    "nodes": [
        {"id": "table:core:MEMBER_PROFILE", "kind": "table", "name": "MEMBER_PROFILE", "displayName": "核心会员档案主表", "namespace": "core", "attributes": {"layer": "源系统"}},
        {"id": "task:load_member", "kind": "task", "name": "JOB_LOAD_MEMBER", "displayName": "会员档案装载任务", "namespace": "scheduler", "attributes": {"plan": "PLAN_DWF_DAY", "status": "enabled"}},
        {"id": "table:dwf:DWF_MEMBER_PROFILE", "kind": "table", "name": "DWF_MEMBER_PROFILE", "displayName": "会员档案明细表", "namespace": "dwf", "attributes": {"layer": "DWF"}},
        {"id": "task:build_member_profile", "kind": "task", "name": "JOB_BUILD_MEMBER_PROFILE", "displayName": "会员画像加工任务", "namespace": "scheduler", "attributes": {"plan": "PLAN_DWM_DAY", "status": "enabled"}},
        {"id": "table:dwm:DWM_MEMBER_PROFILE", "kind": "table", "name": "DWM_MEMBER_PROFILE", "displayName": "会员画像宽表", "namespace": "dwm", "attributes": {"layer": "DWM"}},
        {"id": "task:push_member_profile", "kind": "task", "name": "JOB_PUSH_MEMBER_PROFILE", "displayName": "会员画像推送任务", "namespace": "scheduler", "attributes": {"plan": "PLAN_PUSH_DAY", "status": "enabled"}},
        {"id": "push:cdp:MEMBER_PROFILE", "kind": "push_job", "name": "CDP_MEMBER_PROFILE", "displayName": "会员运营工作台推送", "namespace": "cdp", "attributes": {"system": "DEMO_CDP"}},
    ],
    "edges": [
        {"id": "edge:task_reads:load_member:member_profile", "sourceId": "table:core:MEMBER_PROFILE", "targetId": "task:load_member", "kind": "task_reads_table", "evidence": {"type": "field_mapping", "sourceRecordId": "p_field_mapping_table:42", "description": "显式字段映射"}, "confidence": "high", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
        {"id": "edge:task_writes:load_member:dwf_member_profile", "sourceId": "task:load_member", "targetId": "table:dwf:DWF_MEMBER_PROFILE", "kind": "task_writes_table", "evidence": {"type": "field_mapping", "sourceRecordId": "p_field_mapping_table:42", "description": "显式字段映射"}, "confidence": "high", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
        {"id": "edge:task_reads:profile:dwf_member_profile", "sourceId": "table:dwf:DWF_MEMBER_PROFILE", "targetId": "task:build_member_profile", "kind": "task_reads_table", "evidence": {"type": "controlled_poc", "sourceRecordId": "poc:3", "description": "受控样例任务读表"}, "confidence": "high", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
        {"id": "edge:task_writes:profile:dwm_member_profile", "sourceId": "task:build_member_profile", "targetId": "table:dwm:DWM_MEMBER_PROFILE", "kind": "task_writes_table", "evidence": {"type": "controlled_poc", "sourceRecordId": "poc:4", "description": "受控样例任务写表"}, "confidence": "high", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
        {"id": "edge:task_reads:push:dwm_member_profile", "sourceId": "table:dwm:DWM_MEMBER_PROFILE", "targetId": "task:push_member_profile", "kind": "task_reads_table", "evidence": {"type": "controlled_poc", "sourceRecordId": "poc:5", "description": "受控样例推送任务读表"}, "confidence": "high", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
        {"id": "edge:push_delivery:cdp", "sourceId": "task:push_member_profile", "targetId": "push:cdp:MEMBER_PROFILE", "kind": "push_delivery", "evidence": {"type": "push_metadata", "sourceRecordId": "poc:6", "description": "受控样例推送配置"}, "confidence": "medium", "generatedAt": "2026-07-12T02:00:00Z", "diagnostics": []},
    ],
    "diagnostics": [],
}


class LineageValidationError(ValueError):
    def to_dict(self):
        return {"code": "LINEAGE_VALIDATION_FAILED", "message": str(self)}


class LineageNotFoundError(LineageValidationError):
    status_code = 404

    def to_dict(self):
        return {"code": "LINEAGE_NOT_FOUND", "message": str(self)}


class LineageNoActiveSnapshotError(LineageNotFoundError):
    def to_dict(self):
        return {"code": "NO_ACTIVE_SNAPSHOT", "message": str(self)}


class LineageDataSourceError(LineageValidationError):
    status_code = 503

    def to_dict(self):
        return {"code": "LINEAGE_DATA_SOURCE_ERROR", "message": str(self)}


class LineageConfigurationError(LineageDataSourceError):
    def to_dict(self):
        return {"code": "LINEAGE_CONFIGURATION_ERROR", "message": str(self)}


def lineage_storage_status():
    """Return the safe, explicit storage mode selected for this process."""
    profile = os.getenv(LINEAGE_PROFILE_ENV, "").strip()
    if profile:
        config = get_db_profile(profile)
        provider = get_provider(config["type"])
        schema = provider.physical_schema(config) or config.get("database")
        return {"mode": "persistent", "profile": profile, "schema": schema}

    environment = get_runtime_environment()
    if environment in POC_ENVIRONMENTS:
        return {"mode": "poc", "profile": None, "schema": None}
    raise LineageConfigurationError(
        "lineage data source is not configured; set LINEAGE_DB_PROFILE for non-development environments"
    )


def log_lineage_storage_status():
    """Log only mode, profile name, and schema; never connection details."""
    try:
        status = lineage_storage_status()
    except LineageConfigurationError as error:
        LOGGER.error("Lineage storage is not configured: %s", error)
        return
    if status["mode"] == "persistent":
        LOGGER.info(
            "Lineage storage mode: persistent; Lineage DB profile: %s; Lineage schema: %s",
            status["profile"],
            status["schema"],
        )
        return
    LOGGER.warning("Lineage storage mode: POC; page data is not database lineage")


def _database_snapshot(profile):
    """Load the active snapshot only when explicitly enabled for this service."""
    db = CoreAccess(
        profile_getter=lambda: profile,
        error_factory=LineageDataSourceError,
    )
    try:
        with database_transaction():
            snapshot_rows = db.fetch_rows(
                select(
                    lineage_snapshot.c.snapshot_id,
                    lineage_snapshot.c.generated_at,
                    lineage_snapshot.c.generator_name,
                    lineage_snapshot.c.generator_version,
                )
                .where(lineage_snapshot.c.status_code == "ACTIVE")
                .order_by(lineage_snapshot.c.generated_at.desc(), lineage_snapshot.c.snapshot_id.desc())
                .limit(1)
            )
            if not snapshot_rows:
                raise LineageNoActiveSnapshotError("no active lineage snapshot is available")
            snapshot = snapshot_rows[0]
            snapshot_id = snapshot["snapshot_id"]
            node_rows = db.fetch_rows(
                select(
                    lineage_node.c.node_id,
                    lineage_node.c.kind_code,
                    lineage_node.c.node_name,
                    lineage_node.c.display_name,
                    lineage_node.c.namespace_name,
                    lineage_node.c.attributes_json,
                )
                .where(lineage_node.c.snapshot_id == snapshot_id)
                .order_by(lineage_node.c.node_id)
            )
            edge_rows = db.fetch_rows(
                select(
                    lineage_edge.c.edge_id,
                    lineage_edge.c.source_node_id,
                    lineage_edge.c.target_node_id,
                    lineage_edge.c.kind_code,
                    lineage_edge.c.evidence_type,
                    lineage_edge.c.source_record_id,
                    lineage_edge.c.evidence_description,
                    lineage_edge.c.confidence_code,
                    lineage_edge.c.generated_at,
                    lineage_edge.c.diagnostics_json,
                )
                .where(lineage_edge.c.snapshot_id == snapshot_id)
                .order_by(lineage_edge.c.edge_id)
            )
    except LineageNoActiveSnapshotError:
        raise
    except Exception as error:
        raise LineageDataSourceError("血缘数据图谱暂不可用，请稍后重试") from error

    def decode(value, fallback):
        try:
            return json.loads(value) if value else fallback
        except (TypeError, json.JSONDecodeError):
            return fallback

    diagnostics = []
    nodes = []
    for item in node_rows:
        attributes = decode(item["attributes_json"], {})
        diagnostics.extend(attributes.get("diagnostics", []))
        nodes.append({
            "id": item["node_id"],
            "kind": item["kind_code"],
            "name": item["node_name"],
            "displayName": item["display_name"],
            "namespace": item["namespace_name"],
            "attributes": attributes,
        })
    edges = []
    for item in edge_rows:
        edge_diagnostics = decode(item["diagnostics_json"], [])
        diagnostics.extend(edge_diagnostics)
        edges.append({
            "id": item["edge_id"],
            "sourceId": item["source_node_id"],
            "targetId": item["target_node_id"],
            "kind": item["kind_code"],
            "evidence": {
                "type": item["evidence_type"],
                "sourceRecordId": item["source_record_id"],
                "description": item["evidence_description"],
            },
            "confidence": item["confidence_code"],
            "generatedAt": str(item["generated_at"]),
            "diagnostics": edge_diagnostics,
        })
    unique_diagnostics = list({
        json.dumps(item, ensure_ascii=False, sort_keys=True): item
        for item in diagnostics
    }.values())
    return {
        "snapshotId": snapshot_id,
        "generatedAt": str(snapshot["generated_at"]),
        "generator": {
            "name": snapshot["generator_name"],
            "version": snapshot["generator_version"],
        },
        "nodes": nodes,
        "edges": edges,
        "diagnostics": unique_diagnostics,
    }


def _current_snapshot():
    status = lineage_storage_status()
    return _database_snapshot(status["profile"]) if status["mode"] == "persistent" else SNAPSHOT


def _default_root_id(snapshot):
    """Choose a stable, real root node from the current snapshot."""
    nodes = snapshot["nodes"]
    if not nodes:
        return None
    incoming = {node["id"]: 0 for node in nodes}
    outgoing = {node["id"]: 0 for node in nodes}
    for edge in snapshot["edges"]:
        if edge["sourceId"] in outgoing:
            outgoing[edge["sourceId"]] += 1
        if edge["targetId"] in incoming:
            incoming[edge["targetId"]] += 1
    layers = {"dwf": 0, "dwm": 1, "dwp": 2, "dim": 3, "ods": 4, "api": 5, "report": 6, "push": 7}

    def rank(node):
        node_id = node["id"]
        layer = str(node.get("attributes", {}).get("layer") or node.get("namespace") or "").casefold()
        return (
            node.get("kind") != "table",
            not (incoming[node_id] and outgoing[node_id]),
            layers.get(layer, len(layers)),
            -(incoming[node_id] + outgoing[node_id]),
            node_id,
        )

    return min(nodes, key=rank)["id"]


def _bootstrap_from_snapshot(snapshot, storage_mode):
    return {
        "mode": storage_mode,
        "status": "ready" if snapshot["nodes"] else "empty_snapshot",
        "snapshotId": snapshot["snapshotId"],
        "snapshotName": snapshot["generator"]["name"],
        "snapshotAt": snapshot["generatedAt"],
        "defaultRootId": _default_root_id(snapshot),
        "nodeCount": len(snapshot["nodes"]),
        "edgeCount": len(snapshot["edges"]),
    }


def _missing_snapshot_bootstrap(storage_mode):
    return {
        "mode": storage_mode,
        "status": "no_active_snapshot",
        "defaultRootId": None,
        "nodeCount": 0,
        "edgeCount": 0,
    }


def _decode_json(value, fallback):
    try:
        return json.loads(value) if value else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def _database_node(row, *, joined=False):
    if joined:
        node_id = row.get("node_id")
        kind = row.get("node_kind_code")
        name = row.get("node_name")
        display_name = row.get("node_display_name")
        namespace = row.get("node_namespace_name")
        attributes_json = row.get("node_attributes_json")
    else:
        node_id = row.get("node_id")
        kind = row.get("kind_code")
        name = row.get("node_name")
        display_name = row.get("display_name")
        namespace = row.get("namespace_name")
        attributes_json = row.get("attributes_json")
    attributes = _decode_json(attributes_json, {})
    return {
        "id": node_id,
        "kind": kind,
        "name": name,
        "displayName": display_name,
        "namespace": namespace,
        "attributes": attributes if isinstance(attributes, dict) else {},
    }


def _database_edge(row, *, joined=False):
    def value(key):
        return row.get(f"edge_{key}") if joined else row.get(key)

    diagnostics = _decode_json(value("diagnostics_json"), [])
    return {
        "id": value("edge_id"),
        "sourceId": value("source_node_id"),
        "targetId": value("target_node_id"),
        "kind": value("kind_code"),
        "evidence": {
            "type": value("evidence_type"),
            "sourceRecordId": value("source_record_id"),
            "description": value("evidence_description"),
        },
        "confidence": value("confidence_code"),
        "generatedAt": str(value("generated_at")),
        "diagnostics": diagnostics if isinstance(diagnostics, list) else [],
    }


def _run_persistent_read(profile, operation):
    db = CoreAccess(
        profile_getter=lambda: profile,
        error_factory=LineageDataSourceError,
    )
    reader = LineageDatabaseReader(db)
    try:
        with database_transaction():
            return operation(reader, reader.active_snapshot())
    except LineageValidationError:
        raise
    except Exception as error:
        raise LineageDataSourceError("血缘数据图谱暂不可用，请稍后重试") from error


def _persistent_bootstrap(reader, active_snapshot, storage_mode="persistent"):
    if active_snapshot is None:
        return _missing_snapshot_bootstrap(storage_mode)
    node_count, edge_count = reader.counts(active_snapshot["snapshot_id"])
    root_id = reader.default_root_id(active_snapshot["snapshot_id"]) if node_count else None
    return {
        "mode": storage_mode,
        "status": "ready" if node_count else "empty_snapshot",
        "snapshotId": active_snapshot["snapshot_id"],
        "snapshotName": active_snapshot["generator_name"],
        "snapshotAt": str(active_snapshot["generated_at"]),
        "defaultRootId": root_id,
        "nodeCount": node_count,
        "edgeCount": edge_count,
    }


def _search_limit(value):
    return _bounded_int(
        value,
        LINEAGE_SEARCH_DEFAULT_LIMIT,
        1,
        LINEAGE_SEARCH_MAX_LIMIT,
        "limit",
    )


def _validate_search_name(name):
    normalized_name = str(name or "").strip()
    if not normalized_name:
        raise LineageValidationError("name is required")
    if len(normalized_name) > 100:
        raise LineageValidationError("name must be at most 100 characters")
    return normalized_name


def get_bootstrap():
    """Return safe page initialization data without exposing storage configuration."""
    status = lineage_storage_status()
    if status["mode"] == "persistent":
        return _run_persistent_read(
            status["profile"],
            lambda reader, active: _persistent_bootstrap(reader, active, status["mode"]),
        )
    try:
        snapshot = _current_snapshot()
    except LineageNoActiveSnapshotError:
        return _missing_snapshot_bootstrap(status["mode"])
    return _bootstrap_from_snapshot(snapshot, status["mode"])


def search_nodes(name, limit=None):
    normalized_name = _validate_search_name(name)
    result_limit = _search_limit(limit)
    status = lineage_storage_status()
    if status["mode"] == "persistent":
        escaped = normalized_name.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"

        def search(reader, active):
            if active is None:
                raise LineageNoActiveSnapshotError("no active lineage snapshot is available")
            rows = reader.search_nodes(active["snapshot_id"], pattern, result_limit)
            return [_database_node(row) for row in rows]

        return _run_persistent_read(status["profile"], search)

    searchable_kinds = {"table", "task"}
    matches = [
        deepcopy(node)
        for node in _current_snapshot()["nodes"]
        if node["kind"] in searchable_kinds
        and normalized_name.casefold() in node["name"].casefold()
    ]
    return matches if limit is None else matches[:result_limit]


def _bounded_int(value, default, minimum, maximum, name):
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise LineageValidationError(f"{name} must be an integer") from error
    if not minimum <= parsed <= maximum:
        raise LineageValidationError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _is_dwf_node(node):
    if node.get("kind") != "table":
        return False
    if node.get("attributes", {}).get("dwfBoundary") is True:
        return True
    name = str(node.get("name") or "").upper()
    namespace = str(node.get("namespace") or "").upper()
    return name.startswith(("DWF.", "DWS_DWF.")) or namespace in {"DWF", "DWS_DWF"}


def _project_table_graph(snapshot):
    nodes_by_id = {node["id"]: node for node in snapshot["nodes"]}
    table_nodes = [deepcopy(node) for node in snapshot["nodes"] if node["kind"] == "table"]
    incoming_by_task = {}
    outgoing_by_task = {}
    direct_edges = []
    for edge in snapshot["edges"]:
        source = nodes_by_id.get(edge["sourceId"])
        target = nodes_by_id.get(edge["targetId"])
        if not source or not target:
            continue
        if source["kind"] == "table" and target["kind"] == "task":
            incoming_by_task.setdefault(target["id"], []).append(edge)
        elif source["kind"] == "task" and target["kind"] == "table":
            outgoing_by_task.setdefault(source["id"], []).append(edge)
        elif source["kind"] == target["kind"] == "table":
            direct_edges.append(deepcopy(edge))

    projected = {}
    for task_id in sorted(set(incoming_by_task) | set(outgoing_by_task)):
        task = nodes_by_id[task_id]
        for input_edge in incoming_by_task.get(task_id, []):
            for output_edge in outgoing_by_task.get(task_id, []):
                source_id = input_edge["sourceId"]
                target_id = output_edge["targetId"]
                if source_id == target_id:
                    continue
                key = (source_id, target_id)
                item = projected.setdefault(key, {
                    "sourceId": source_id,
                    "targetId": target_id,
                    "jobs": [],
                    "evidence": [],
                    "diagnostics": [],
                })
                if task["name"] not in item["jobs"]:
                    item["jobs"].append(task["name"])
                item["evidence"].append(input_edge["evidence"])
                item["diagnostics"].extend(input_edge.get("diagnostics", []))
                item["diagnostics"].extend(output_edge.get("diagnostics", []))

    edges = direct_edges
    for (source_id, target_id), item in sorted(projected.items()):
        digest = hashlib.sha256(f"{source_id}\x1f{target_id}".encode("utf-8")).hexdigest()[:24]
        jobs = sorted(item["jobs"])
        evidence = item["evidence"][0]
        edges.append({
            "id": f"edge:table_lineage:{digest}",
            "sourceId": source_id,
            "targetId": target_id,
            "kind": "table_lineage",
            "viaJobs": jobs,
            "evidence": {
                "type": "derived_job_path",
                "sourceRecordId": evidence["sourceRecordId"],
                "description": f"经过作业：{'、'.join(jobs)}；{evidence['description']}",
            },
            "confidence": "high",
            "generatedAt": snapshot["generatedAt"],
            "diagnostics": item["diagnostics"],
        })
    return {**snapshot, "nodes": table_nodes, "edges": edges}


def _traverse(snapshot, root_id, direction, depth, max_nodes):
    nodes_by_id = {node["id"]: node for node in snapshot["nodes"]}
    outgoing = {}
    incoming = {}
    for edge in snapshot["edges"]:
        outgoing.setdefault(edge["sourceId"], []).append(edge["targetId"])
        incoming.setdefault(edge["targetId"], []).append(edge["sourceId"])

    selected = {root_id}
    truncated = False

    def walk(branch):
        nonlocal truncated
        queue = deque([(root_id, 0)])
        best_cost = {root_id: 0}
        while queue:
            current, table_depth = queue.popleft()
            current_node = nodes_by_id[current]
            if branch == "upstream" and _is_dwf_node(current_node):
                continue
            if current_node["kind"] == "table" and table_depth >= depth:
                continue
            neighbors = incoming.get(current, []) if branch == "upstream" else outgoing.get(current, [])
            for neighbor in neighbors:
                neighbor_node = nodes_by_id.get(neighbor)
                if not neighbor_node:
                    continue
                next_depth = table_depth + (1 if neighbor_node["kind"] == "table" else 0)
                if next_depth > depth:
                    continue
                previous = best_cost.get(neighbor)
                if previous is not None and previous <= next_depth:
                    continue
                if neighbor not in selected and len(selected) >= max_nodes:
                    truncated = True
                    continue
                best_cost[neighbor] = next_depth
                selected.add(neighbor)
                queue.append((neighbor, next_depth))

    if direction in {"upstream", "both"}:
        walk("upstream")
    if direction in {"downstream", "both"}:
        walk("downstream")
    return selected, truncated


def _subgraph_from_snapshot(snapshot, root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    direction = direction or "both"
    if direction not in {"upstream", "downstream", "both"}:
        raise LineageValidationError("direction must be upstream, downstream, or both")
    view = view or "table"
    if view not in {"table", "detail"}:
        raise LineageValidationError("view must be table or detail")
    depth = _bounded_int(depth, 2, 0, 5, "depth")
    max_nodes = _bounded_int(max_nodes, 100, 1, 300, "maxNodes")
    root_id = root_id or _default_root_id(snapshot)
    source_nodes_by_id = {node["id"]: node for node in snapshot["nodes"]}
    if root_id is None:
        raise LineageNotFoundError("the current snapshot has no available root node")
    if root_id not in source_nodes_by_id:
        raise LineageNotFoundError("rootId is not available in the current snapshot")
    if view == "table" and source_nodes_by_id[root_id]["kind"] != "table":
        raise LineageValidationError("table view requires a table root node")
    view_snapshot = _project_table_graph(snapshot) if view == "table" else snapshot
    selected, truncated = _traverse(view_snapshot, root_id, direction, depth, max_nodes)
    edges = [edge for edge in view_snapshot["edges"] if edge["sourceId"] in selected and edge["targetId"] in selected]
    return {
        "snapshot": {key: deepcopy(view_snapshot[key]) for key in ("snapshotId", "generatedAt", "generator")},
        "rootId": root_id,
        "view": view,
        "nodes": [deepcopy(node) for node in view_snapshot["nodes"] if node["id"] in selected],
        "edges": deepcopy(edges),
        "truncated": truncated,
        "diagnostics": deepcopy(view_snapshot["diagnostics"]),
    }


class _PersistentAdjacencyBudget:
    """Bound rows materialized by a single persistent subgraph request."""

    def __init__(self):
        self.rows_read = 0
        self.truncated = False

    def fetch(self, reader, snapshot_id, node_ids, direction, available_nodes):
        if not node_ids:
            return []
        remaining = MAX_LINEAGE_SUBGRAPH_EDGE_ROWS - self.rows_read
        if remaining <= 0:
            self.truncated = True
            return []
        desired = min(
            remaining,
            max(1, available_nodes) * LINEAGE_SUBGRAPH_EDGE_READS_PER_NODE,
        )
        rows = reader.adjacent(snapshot_id, node_ids, direction, desired + 1)
        if len(rows) > desired:
            self.truncated = True
            rows = rows[:desired]
        self.rows_read += len(rows)
        return rows


def _merge_projected_path(projected, source_id, target_id, task, input_edge, output_edge):
    if source_id == target_id:
        return
    item = projected.setdefault(
        (source_id, target_id),
        {"jobs": [], "evidence": None, "diagnostics": []},
    )
    if task["name"] not in item["jobs"]:
        item["jobs"].append(task["name"])
    if item["evidence"] is None:
        item["evidence"] = deepcopy(input_edge["evidence"])
    item["diagnostics"].extend(input_edge.get("diagnostics", []))
    item["diagnostics"].extend(output_edge.get("diagnostics", []))


def _render_projected_edges(projected, generated_at):
    edges = []
    for (source_id, target_id), item in sorted(projected.items()):
        jobs = sorted(item["jobs"])
        evidence = item["evidence"] or {"sourceRecordId": None, "description": ""}
        digest = hashlib.sha256(f"{source_id}\x1f{target_id}".encode("utf-8")).hexdigest()[:24]
        edges.append({
            "id": f"edge:table_lineage:{digest}",
            "sourceId": source_id,
            "targetId": target_id,
            "kind": "table_lineage",
            "viaJobs": jobs,
            "evidence": {
                "type": "derived_job_path",
                "sourceRecordId": evidence.get("sourceRecordId"),
                "description": f"经过作业：{'、'.join(jobs)}；{evidence.get('description') or ''}",
            },
            "confidence": "high",
            "generatedAt": generated_at,
            "diagnostics": deepcopy(item["diagnostics"]),
        })
    return edges


def _walk_persistent_detail(
    reader, snapshot_id, root, direction, depth, max_nodes, selected_nodes, edges, budget
):
    branches = ("upstream", "downstream") if direction == "both" else (direction,)
    for branch in branches:
        best_cost = {root["id"]: 0}
        expanded = set()
        frontier = [(root["id"], 0)]
        while frontier:
            grouped = {}
            for node_id, table_depth in frontier:
                grouped.setdefault(table_depth, []).append(node_id)
            next_costs = {}
            for table_depth, node_ids in grouped.items():
                expandable = []
                for node_id in dict.fromkeys(node_ids):
                    node = selected_nodes.get(node_id)
                    if node is None or node_id in expanded:
                        continue
                    if branch == "upstream" and _is_dwf_node(node):
                        continue
                    if node["kind"] == "table" and table_depth >= depth:
                        continue
                    expandable.append(node_id)
                if not expandable:
                    continue
                expanded.update(expandable)

                rows = budget.fetch(
                    reader,
                    snapshot_id,
                    expandable,
                    branch,
                    max_nodes - len(selected_nodes),
                )
                for row in rows:
                    neighbor = _database_node(row, joined=True)
                    neighbor_id = neighbor["id"]
                    next_depth = table_depth + (1 if neighbor["kind"] == "table" else 0)
                    if next_depth > depth:
                        continue
                    previous = best_cost.get(neighbor_id)
                    if previous is not None and previous <= next_depth:
                        continue
                    if neighbor_id not in selected_nodes:
                        if len(selected_nodes) >= max_nodes:
                            budget.truncated = True
                            continue
                        selected_nodes[neighbor_id] = neighbor
                    best_cost[neighbor_id] = next_depth
                    if neighbor_id not in next_costs or next_depth < next_costs[neighbor_id]:
                        next_costs[neighbor_id] = next_depth

                # Keep all fetched edges whose endpoints are selected. This
                # preserves cycles and cross-links without loading unrelated edges.
                for row in rows:
                    edge = _database_edge(row, joined=True)
                    if edge["sourceId"] in selected_nodes and edge["targetId"] in selected_nodes:
                        edges.setdefault(edge["id"], edge)

            if not next_costs:
                break
            if len(selected_nodes) >= max_nodes:
                budget.truncated = True
                break
            frontier = list(next_costs.items())


def _walk_persistent_table(
    reader,
    snapshot_id,
    root,
    direction,
    depth,
    max_nodes,
    selected_nodes,
    direct_edges,
    projected,
    task_budget,
    projection_budget,
    budget,
):
    branches = ("upstream", "downstream") if direction == "both" else (direction,)
    for branch in branches:
        best_cost = {root["id"]: 0}
        expanded = set()
        frontier = [(root["id"], 0)]
        while frontier:
            grouped = {}
            for node_id, table_depth in frontier:
                grouped.setdefault(table_depth, []).append(node_id)
            next_costs = {}
            for table_depth, node_ids in grouped.items():
                frontier_ids = list(dict.fromkeys(node_ids))
                expandable = [
                    node_id
                    for node_id in frontier_ids
                    if node_id in selected_nodes
                    and node_id not in expanded
                    and not (branch == "upstream" and _is_dwf_node(selected_nodes[node_id]))
                    and table_depth < depth
                ]
                if not expandable:
                    continue
                expanded.update(expandable)

                free_nodes = max_nodes - len(selected_nodes)
                first_rows = budget.fetch(
                    reader, snapshot_id, expandable, branch, free_nodes
                )
                tasks = {}
                direct_candidates = {}
                for row in first_rows:
                    edge = _database_edge(row, joined=True)
                    neighbor = _database_node(row, joined=True)
                    if neighbor["kind"] == "table":
                        neighbor_id = neighbor["id"]
                        if (
                            branch == "downstream" and edge["sourceId"] in expandable
                        ) or (
                            branch == "upstream" and edge["targetId"] in expandable
                        ):
                            direct_edges.setdefault(edge["id"], edge)
                            direct_candidates.setdefault(neighbor_id, neighbor)
                    elif neighbor["kind"] == "task":
                        task_id = neighbor["id"]
                        if (
                            branch == "downstream"
                            and edge["sourceId"] in expandable
                            and edge["targetId"] == task_id
                        ) or (
                            branch == "upstream"
                            and edge["targetId"] in expandable
                            and edge["sourceId"] == task_id
                        ):
                            tasks.setdefault(task_id, neighbor)

                task_ids = list(tasks)
                max_tasks = MAX_LINEAGE_TABLE_VIEW_TASKS
                new_task_capacity = max(0, max_tasks - len(task_budget))
                admitted_new_tasks = [
                    task_id for task_id in task_ids if task_id not in task_budget
                ][:new_task_capacity]
                if len(admitted_new_tasks) < len(
                    [task_id for task_id in task_ids if task_id not in task_budget]
                ):
                    budget.truncated = True
                task_budget.update(admitted_new_tasks)
                allowed_task_ids = [task_id for task_id in task_ids if task_id in task_budget]
                if allowed_task_ids:
                    second_rows = budget.fetch(
                        reader,
                        snapshot_id,
                        allowed_task_ids,
                        branch,
                        max_nodes - len(selected_nodes),
                    )
                else:
                    second_rows = []

                inputs_by_task = {}
                outputs_by_task = {}
                table_nodes = dict(direct_candidates)
                second_nodes_by_edge = {}
                if branch == "downstream":
                    for row in first_rows:
                        edge = _database_edge(row, joined=True)
                        node = _database_node(row, joined=True)
                        if (
                            node["kind"] == "task"
                            and edge["sourceId"] in expandable
                            and edge["targetId"] in allowed_task_ids
                        ):
                            inputs_by_task.setdefault(edge["targetId"], []).append(edge)
                    for row in second_rows:
                        edge = _database_edge(row, joined=True)
                        node = _database_node(row, joined=True)
                        second_nodes_by_edge[edge["id"]] = node
                        if (
                            edge["sourceId"] in allowed_task_ids
                            and node["kind"] == "table"
                        ):
                            outputs_by_task.setdefault(edge["sourceId"], []).append(edge)
                            table_nodes.setdefault(node["id"], node)
                else:
                    for row in first_rows:
                        edge = _database_edge(row, joined=True)
                        node = _database_node(row, joined=True)
                        if (
                            node["kind"] == "task"
                            and edge["sourceId"] == node["id"]
                            and edge["targetId"] in expandable
                        ):
                            outputs_by_task.setdefault(edge["sourceId"], []).append(edge)
                    for row in second_rows:
                        edge = _database_edge(row, joined=True)
                        node = _database_node(row, joined=True)
                        second_nodes_by_edge[edge["id"]] = node
                        if (
                            edge["targetId"] in allowed_task_ids
                            and node["kind"] == "table"
                        ):
                            inputs_by_task.setdefault(edge["targetId"], []).append(edge)
                            table_nodes.setdefault(node["id"], node)

                layer_projection = {}
                stop_projection = False
                for task_id in allowed_task_ids:
                    task = tasks[task_id]
                    for input_edge in inputs_by_task.get(task_id, []):
                        for output_edge in outputs_by_task.get(task_id, []):
                            if projection_budget["used"] >= MAX_LINEAGE_TABLE_PROJECTION_PAIRS:
                                budget.truncated = True
                                stop_projection = True
                                break
                            projection_budget["used"] += 1
                            source_id = input_edge["sourceId"]
                            target_id = output_edge["targetId"]
                            if source_id == target_id:
                                continue
                            _merge_projected_path(
                                projected,
                                source_id,
                                target_id,
                                task,
                                input_edge,
                                output_edge,
                            )
                            _merge_projected_path(
                                layer_projection,
                                source_id,
                                target_id,
                                task,
                                input_edge,
                                output_edge,
                            )
                            neighbor_id = target_id if branch == "downstream" else source_id
                            neighbor_node = second_nodes_by_edge.get(
                                output_edge["id"] if branch == "downstream" else input_edge["id"]
                            )
                            if neighbor_node is not None:
                                table_nodes.setdefault(neighbor_id, neighbor_node)
                        if stop_projection:
                            break
                    if stop_projection:
                        break

                candidates = dict(direct_candidates)
                for source_id, target_id in sorted(layer_projection):
                    neighbor_id = target_id if branch == "downstream" else source_id
                    node = table_nodes.get(neighbor_id)
                    if node is not None:
                        candidates.setdefault(neighbor_id, node)

                next_depth = table_depth + 1
                if next_depth > depth:
                    continue
                for neighbor_id, neighbor in candidates.items():
                    previous = best_cost.get(neighbor_id)
                    if previous is not None and previous <= next_depth:
                        continue
                    if neighbor_id not in selected_nodes:
                        if len(selected_nodes) >= max_nodes:
                            budget.truncated = True
                            continue
                        selected_nodes[neighbor_id] = neighbor
                    best_cost[neighbor_id] = next_depth
                    if neighbor_id not in next_costs or next_depth < next_costs[neighbor_id]:
                        next_costs[neighbor_id] = next_depth

            if not next_costs:
                break
            if len(selected_nodes) >= max_nodes:
                budget.truncated = True
                break
            frontier = list(next_costs.items())


def _persistent_diagnostics(nodes, edges):
    diagnostics = []
    for node in nodes:
        diagnostics.extend(node.get("attributes", {}).get("diagnostics", []))
    for edge in edges:
        diagnostics.extend(edge.get("diagnostics", []))
    return list({
        json.dumps(item, ensure_ascii=False, sort_keys=True): item
        for item in diagnostics
    }.values())


def _database_subgraph(
    reader,
    active_snapshot,
    root_id=None,
    direction="both",
    depth=None,
    max_nodes=None,
    view="table",
    *,
    default_root_id=None,
):
    if active_snapshot is None:
        raise LineageNoActiveSnapshotError("no active lineage snapshot is available")
    direction = direction or "both"
    if direction not in {"upstream", "downstream", "both"}:
        raise LineageValidationError("direction must be upstream, downstream, or both")
    view = view or "table"
    if view not in {"table", "detail"}:
        raise LineageValidationError("view must be table or detail")
    depth = _bounded_int(depth, 2, 0, 5, "depth")
    max_nodes = _bounded_int(max_nodes, 100, 1, 300, "maxNodes")
    snapshot_id = active_snapshot["snapshot_id"]
    if not root_id:
        root_id = default_root_id or reader.default_root_id(snapshot_id)
    if root_id is None:
        raise LineageNotFoundError("the current snapshot has no available root node")
    root_row = reader.node(snapshot_id, root_id)
    if root_row is None:
        raise LineageNotFoundError("rootId is not available in the current snapshot")
    root = _database_node(root_row)
    if view == "table" and root["kind"] != "table":
        raise LineageValidationError("table view requires a table root node")

    selected_nodes = {root["id"]: root}
    budget = _PersistentAdjacencyBudget()
    detail_edges = {}
    direct_edges = {}
    projected = {}
    if view == "detail":
        _walk_persistent_detail(
            reader,
            snapshot_id,
            root,
            direction,
            depth,
            max_nodes,
            selected_nodes,
            detail_edges,
            budget,
        )
        visible_edges = [
            edge for edge in detail_edges.values()
            if edge["sourceId"] in selected_nodes and edge["targetId"] in selected_nodes
        ]
    else:
        _walk_persistent_table(
            reader,
            snapshot_id,
            root,
            direction,
            depth,
            max_nodes,
            selected_nodes,
            direct_edges,
            projected,
            set(),
            {"used": 0},
            budget,
        )
        visible_edges = [
            edge for edge in direct_edges.values()
            if edge["sourceId"] in selected_nodes and edge["targetId"] in selected_nodes
        ]
        visible_edges.extend(
            edge for edge in _render_projected_edges(projected, str(active_snapshot["generated_at"]))
            if edge["sourceId"] in selected_nodes and edge["targetId"] in selected_nodes
        )

    nodes = sorted(selected_nodes.values(), key=lambda node: node["id"])
    visible_edges.sort(key=lambda edge: edge["id"])
    return {
        "snapshot": {
            "snapshotId": active_snapshot["snapshot_id"],
            "generatedAt": str(active_snapshot["generated_at"]),
            "generator": {
                "name": active_snapshot["generator_name"],
                "version": active_snapshot["generator_version"],
            },
        },
        "rootId": root_id,
        "view": view,
        "nodes": deepcopy(nodes),
        "edges": deepcopy(visible_edges),
        "truncated": budget.truncated,
        "diagnostics": deepcopy(_persistent_diagnostics(nodes, visible_edges)),
    }


def get_subgraph(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    status = lineage_storage_status()
    if status["mode"] == "persistent":
        return _run_persistent_read(
            status["profile"],
            lambda reader, active: _database_subgraph(
                reader, active, root_id, direction, depth, max_nodes, view
            ),
        )
    return _subgraph_from_snapshot(_current_snapshot(), root_id, direction, depth, max_nodes, view)


def get_initial_view(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    """Load bootstrap metadata and the requested graph from one current snapshot."""
    status = lineage_storage_status()
    if status["mode"] == "persistent":
        def initial(reader, active):
            if active is None:
                return {
                    "bootstrap": _missing_snapshot_bootstrap(status["mode"]),
                    "graph": None,
                    "noticeCode": None,
                }
            bootstrap = _persistent_bootstrap(reader, active, status["mode"])
            if bootstrap["status"] != "ready" or not bootstrap["defaultRootId"]:
                return {"bootstrap": bootstrap, "graph": None, "noticeCode": None}

            try:
                graph = _database_subgraph(
                    reader, active, root_id, direction, depth, max_nodes, view,
                    default_root_id=bootstrap["defaultRootId"],
                )
                return {"bootstrap": bootstrap, "graph": graph, "noticeCode": None}
            except LineageNotFoundError:
                if not root_id or root_id == bootstrap["defaultRootId"]:
                    raise
                notice_code = "ROOT_NOT_IN_SNAPSHOT"
            except LineageValidationError:
                root_row = reader.node(active["snapshot_id"], root_id) if root_id else None
                requested_root = _database_node(root_row) if root_row else None
                can_recover_task_in_table_view = (
                    view == "table"
                    and root_id
                    and root_id != bootstrap["defaultRootId"]
                    and (requested_root is None or requested_root.get("kind") != "table")
                )
                if not can_recover_task_in_table_view:
                    raise
                notice_code = "TABLE_VIEW_REQUIRES_TABLE_ROOT"

            graph = _database_subgraph(
                reader,
                active,
                bootstrap["defaultRootId"],
                direction,
                depth,
                max_nodes,
                "table",
                default_root_id=bootstrap["defaultRootId"],
            )
            return {"bootstrap": bootstrap, "graph": graph, "noticeCode": notice_code}

        return _run_persistent_read(status["profile"], initial)

    try:
        snapshot = _current_snapshot()
    except LineageNoActiveSnapshotError:
        return {
            "bootstrap": _missing_snapshot_bootstrap(status["mode"]),
            "graph": None,
            "noticeCode": None,
        }

    bootstrap = _bootstrap_from_snapshot(snapshot, status["mode"])
    if bootstrap["status"] != "ready" or not bootstrap["defaultRootId"]:
        return {"bootstrap": bootstrap, "graph": None, "noticeCode": None}

    try:
        graph = _subgraph_from_snapshot(snapshot, root_id, direction, depth, max_nodes, view)
        return {"bootstrap": bootstrap, "graph": graph, "noticeCode": None}
    except LineageNotFoundError:
        if not root_id or root_id == bootstrap["defaultRootId"]:
            raise
        notice_code = "ROOT_NOT_IN_SNAPSHOT"
    except LineageValidationError:
        nodes_by_id = {node["id"]: node for node in snapshot["nodes"]}
        can_recover_task_in_table_view = (
            view == "table"
            and root_id
            and root_id != bootstrap["defaultRootId"]
            and nodes_by_id.get(root_id, {}).get("kind") != "table"
        )
        if not can_recover_task_in_table_view:
            raise
        notice_code = "TABLE_VIEW_REQUIRES_TABLE_ROOT"

    graph = _subgraph_from_snapshot(
        snapshot,
        bootstrap["defaultRootId"],
        direction,
        depth,
        max_nodes,
        "table",
    )
    return {"bootstrap": bootstrap, "graph": graph, "noticeCode": notice_code}
