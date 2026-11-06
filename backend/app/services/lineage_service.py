"""Lineage graph services backed by the selected DAP metadata database.

There is exactly one read path: the `ASSET_DB_PROFILE` metadata database that
also holds every other DAP asset table. Synthetic in-memory graphs are not part
of this module, so a missing profile, an unreachable database, a missing
lineage table and an ACTIVE-snapshot-free database stay distinguishable instead
of collapsing into demo data.
"""

# pyright: reportMissingImports=false

from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import logging

from ..db.facade import database_transaction, get_db_profile, resolve_db_profile_name
from ..db.registry import get_provider
from ..db.service import CoreAccess
from .lineage_database_reader import LineageDatabaseReader, escape_like_operand


LOGGER = logging.getLogger(__name__)
LINEAGE_SEARCH_DEFAULT_LIMIT = 100
LINEAGE_SEARCH_MAX_LIMIT = 300
MAX_LINEAGE_SUBGRAPH_EDGE_ROWS = 10_000
LINEAGE_SUBGRAPH_EDGE_READS_PER_NODE = 16
MAX_LINEAGE_TABLE_VIEW_TASKS = 800
MAX_LINEAGE_TABLE_PROJECTION_PAIRS = 20_000


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
    """Resolve lineage storage from the same DB profile as all DAP metadata."""
    try:
        profile = resolve_db_profile_name()
        config = get_db_profile(profile)
        provider = get_provider(config["type"])
        schema = provider.physical_schema(config) or config.get("database")
    except Exception as error:
        # Fail closed: a missing/misconfigured DAP DB is never a demo graph.
        raise LineageConfigurationError(
            "血缘使用 ASSET_DB_PROFILE 对应的 DAP 参数库，请检查数据库配置。"
        ) from error
    return {"mode": "persistent", "profile": profile, "schema": schema}


def log_lineage_storage_status():
    """Log only mode, profile name, and schema; never connection details."""
    try:
        status = lineage_storage_status()
    except LineageConfigurationError as error:
        LOGGER.error("Lineage storage is not configured: %s", error)
        return
    LOGGER.info(
        "Lineage storage mode: %s; DAP DB profile: %s; DAP schema: %s",
        status["mode"],
        status["profile"],
        status["schema"],
    )


def _missing_snapshot_bootstrap(storage_mode):
    return {
        "mode": storage_mode,
        "status": "no_active_snapshot",
        "defaultRootId": None,
        "nodeCount": 0,
        "edgeCount": 0,
    }


def _decode_json(value, fallback):
    if value is None or value == "":
        return fallback
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError) as error:
        raise LineageDataSourceError("血缘持久化数据格式无效，请联系管理员核查。") from error
    if not isinstance(parsed, type(fallback)):
        raise LineageDataSourceError("血缘持久化数据格式无效，请联系管理员核查。")
    return parsed


def _lineage_schema_from_attributes(attributes):
    if not isinstance(attributes, dict):
        return None
    for key in ("schema", "schemaName", "schema_name"):
        value = attributes.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


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
    attributes = attributes if isinstance(attributes, dict) else {}
    node = {
        "id": node_id,
        "kind": kind,
        "name": name,
        "displayName": display_name,
        "namespace": namespace,
        "attributes": attributes,
    }
    schema_name = _lineage_schema_from_attributes(attributes)
    if schema_name is not None:
        node["schema"] = schema_name
    return node


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


def _split_lineage_search_name(normalized_name):
    """Return optional business namespace and table-name search fragments."""
    if "." not in normalized_name:
        return None, normalized_name
    namespace, table_name = (part.strip() for part in normalized_name.split(".", 1))
    if not namespace or not table_name:
        raise LineageValidationError("schema.table must include both names")
    return namespace, table_name


def get_bootstrap():
    """Return safe page initialization data without exposing storage configuration."""
    status = lineage_storage_status()
    return _run_persistent_read(
        status["profile"],
        lambda reader, active: _persistent_bootstrap(reader, active, status["mode"]),
    )


def search_nodes(name, limit=None):
    normalized_name = _validate_search_name(name)
    namespace, table_name = _split_lineage_search_name(normalized_name)
    result_limit = _search_limit(limit)
    name_pattern = f"%{escape_like_operand(table_name.casefold())}%"
    namespace_pattern = (
        f"%{escape_like_operand(namespace.casefold())}%"
        if namespace is not None
        else None
    )
    status = lineage_storage_status()

    def search(reader, active):
        if active is None:
            raise LineageNoActiveSnapshotError("no active lineage snapshot is available")
        rows = reader.search_nodes(
            active["snapshot_id"],
            name_pattern,
            result_limit,
            exact_name=table_name.casefold(),
            namespace_pattern=namespace_pattern,
            exact_namespace=namespace.casefold() if namespace is not None else None,
            exact_qualified_name=(
                f"{namespace}.{table_name}".casefold()
                if namespace is not None
                else None
            ),
        )
        return [_database_node(row) for row in rows]

    return _run_persistent_read(status["profile"], search)


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


def _validated_graph_options(direction, depth, max_nodes, view):
    """Reject malformed graph options before any storage resolution happens."""
    direction = direction or "both"
    if direction not in {"upstream", "downstream", "both"}:
        raise LineageValidationError("direction must be upstream, downstream, or both")
    view = view or "table"
    if view not in {"table", "detail"}:
        raise LineageValidationError("view must be table or detail")
    return (
        direction,
        _bounded_int(depth, 2, 0, 5, "depth"),
        _bounded_int(max_nodes, 100, 1, 300, "maxNodes"),
        view,
    )


def get_subgraph(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    direction, depth, max_nodes, view = _validated_graph_options(
        direction, depth, max_nodes, view
    )
    status = lineage_storage_status()
    return _run_persistent_read(
        status["profile"],
        lambda reader, active: _database_subgraph(
            reader, active, root_id, direction, depth, max_nodes, view
        ),
    )


def get_initial_view(root_id=None, direction="both", depth=None, max_nodes=None, view="table"):
    """Load bootstrap metadata and the requested graph from one current snapshot."""
    direction, depth, max_nodes, view = _validated_graph_options(
        direction, depth, max_nodes, view
    )
    status = lineage_storage_status()

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
