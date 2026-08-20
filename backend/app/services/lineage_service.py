"""Controlled lineage POC data contract.

The daily collector will replace this in-memory snapshot.  The portal owns the
contract and graph traversal; renderers only receive the resulting subgraph.
"""

from __future__ import annotations

from collections import deque
from copy import deepcopy
import hashlib
import json
import logging
import os

from sqlalchemy import select

from ..db.gaussdb import database_transaction
from ..db.service import CoreAccess
from ..db.tables import lineage_edge, lineage_node, lineage_snapshot


LOGGER = logging.getLogger(__name__)
LINEAGE_PROFILE_ENV = "LINEAGE_DB_PROFILE"
POC_ENVIRONMENTS = {"development", "dev", "test"}

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
        return {"mode": "persistent", "profile": profile, "schema": "dwp"}

    environment = os.getenv("FLASK_ENV", "production").strip().lower()
    edition = os.getenv("ASSET_EDITION", "private").strip().lower()
    if environment in POC_ENVIRONMENTS or edition == "community":
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


def get_bootstrap():
    """Return safe page initialization data without exposing storage configuration."""
    status = lineage_storage_status()
    try:
        snapshot = _current_snapshot()
    except LineageNoActiveSnapshotError:
        return _missing_snapshot_bootstrap(status["mode"])
    return _bootstrap_from_snapshot(snapshot, status["mode"])


def search_nodes(name):
    normalized_name = str(name or "").strip()
    if not normalized_name:
        raise LineageValidationError("name is required")
    if len(normalized_name) > 100:
        raise LineageValidationError("name must be at most 100 characters")
    query = normalized_name.casefold()
    searchable_kinds = {"table", "task"}
    return [
        deepcopy(node)
        for node in _current_snapshot()["nodes"]
        if node["kind"] in searchable_kinds and query in node["name"].casefold()
    ]


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


def get_subgraph(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    return _subgraph_from_snapshot(_current_snapshot(), root_id, direction, depth, max_nodes, view)


def get_initial_view(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    """Load bootstrap metadata and the requested graph from one current snapshot."""
    status = lineage_storage_status()
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
