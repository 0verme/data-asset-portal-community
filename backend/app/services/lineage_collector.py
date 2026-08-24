"""Build and atomically publish lineage snapshots from scheduler metadata.

The collector reads job / program rows through the scheduler adapter
(``backend.app.services.lineage.scheduler``). Community core never hard-codes
a deployment-specific scheduler schema; table names come from configuration
(``LINEAGE_JOB_TABLE`` / ``LINEAGE_PROGRAM_TABLE``, default ``p_job`` /
``p_program``) and are identifier-validated before SQL is built.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json

from ..db.facade import (
    database_transaction,
    execute_many,
    execute_sql,
    fetch_all,
)
from .lineage.scheduler import (
    DEFAULT_JOB_TABLE,
    DEFAULT_PROGRAM_TABLE,
    job_sql,
    program_sql,
    resolve_scheduler_tables,
)


def normalize_name(value) -> str:
    return "" if value is None else str(value).strip().upper()


def normalize_table_name(value) -> str:
    return normalize_name(value).replace("`", "").replace('"', "")


def is_dwf_table(table_name: str) -> bool:
    normalized = normalize_table_name(table_name)
    return normalized.startswith("DWF.") or normalized.startswith("DWS_DWF.")


def parse_dependencies(value) -> tuple[list[tuple[str, str]], list[dict]]:
    dependencies = []
    diagnostics = []
    text = "" if value is None else str(value).strip()
    if not text:
        return dependencies, diagnostics
    for raw_segment in text.split("|"):
        segment = raw_segment.strip()
        dependency_type, separator, job_name = segment.partition(":")
        normalized_job = normalize_name(job_name)
        if not separator or not dependency_type.isdigit() or not normalized_job:
            diagnostics.append({
                "code": "INVALID_DEPENDENCY_SEGMENT",
                "message": f"无法解析作业依赖片段：{segment}",
            })
            continue
        item = (normalized_job, dependency_type)
        if item not in dependencies:
            dependencies.append(item)
    return dependencies, diagnostics


def _stable_id(*parts) -> str:
    payload = "\x1f".join(str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _table_node_id(table_name: str) -> str:
    namespace, _, name = table_name.partition(".")
    return f"table:{namespace.lower()}:{name}"


def _task_node_id(job_name: str) -> str:
    return f"task:{job_name}"


def _find_cycles(dependencies: dict[str, list[tuple[str, str]]]) -> list[list[str]]:
    cycles = []
    visited = set()
    active = []
    active_set = set()

    def visit(job_name):
        if job_name in active_set:
            start = active.index(job_name)
            cycle = active[start:] + [job_name]
            if cycle not in cycles:
                cycles.append(cycle)
            return
        if job_name in visited:
            return
        active.append(job_name)
        active_set.add(job_name)
        for upstream_job, _ in dependencies.get(job_name, []):
            visit(upstream_job)
        active.pop()
        active_set.remove(job_name)
        visited.add(job_name)

    for job_name in sorted(dependencies):
        visit(job_name)
    return cycles


def build_snapshot(job_rows, table_job_rows, *, snapshot_id=None, generated_at=None,
                   job_table=DEFAULT_JOB_TABLE, program_table=DEFAULT_PROGRAM_TABLE):
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    snapshot_id = snapshot_id or f"JOB_TABLE_{datetime.now(timezone.utc):%Y%m%d%H%M%S%f}"
    plans = defaultdict(set)
    dependencies = defaultdict(list)
    job_diagnostics = defaultdict(list)
    declared_jobs = set()

    for plan_name, job_name, dependency_text in job_rows:
        current_job = normalize_name(job_name)
        if not current_job:
            continue
        declared_jobs.add(current_job)
        normalized_plan = normalize_name(plan_name)
        if normalized_plan:
            plans[current_job].add(normalized_plan)
        parsed, diagnostics = parse_dependencies(dependency_text)
        job_diagnostics[current_job].extend(diagnostics)
        for dependency in parsed:
            if dependency not in dependencies[current_job]:
                dependencies[current_job].append(dependency)

    if not declared_jobs:
        raise ValueError(f"{job_table} contains no usable jobs")

    tables_by_job = defaultdict(set)
    for table_name, job_name in table_job_rows:
        normalized_job = normalize_name(job_name)
        normalized_table = normalize_table_name(table_name)
        if normalized_job and normalized_table and "." in normalized_table:
            tables_by_job[normalized_job].add(normalized_table)
    if not tables_by_job:
        raise ValueError(f"{program_table} contains no usable job-to-table mappings")

    referenced_jobs = {
        upstream_job
        for job_dependencies in dependencies.values()
        for upstream_job, _ in job_dependencies
    }
    all_jobs = declared_jobs | referenced_jobs
    for job_name in sorted(all_jobs):
        if job_name not in declared_jobs:
            job_diagnostics[job_name].append({
                "code": "MISSING_JOB",
                "message": f"前置作业 {job_name} 未出现在 {job_table}.c 中",
            })
        if not tables_by_job.get(job_name):
            job_diagnostics[job_name].append({
                "code": "UNMAPPED_JOB",
                "message": f"作业 {job_name} 未映射到结果表",
            })

    cycles = _find_cycles(dependencies)
    for cycle in cycles:
        message = "检测到作业依赖环：" + " → ".join(cycle)
        for job_name in set(cycle):
            job_diagnostics[job_name].append({"code": "DEPENDENCY_CYCLE", "message": message})

    nodes = []
    for job_name in sorted(all_jobs):
        nodes.append({
            "id": _task_node_id(job_name),
            "kind": "task",
            "name": job_name,
            "displayName": job_name,
            "namespace": "scheduler",
            "attributes": {
                "plans": sorted(plans.get(job_name, set())),
                "source": f"dwp.{job_table}",
                "diagnostics": job_diagnostics.get(job_name, []),
            },
        })
    all_tables = sorted({table for tables in tables_by_job.values() for table in tables})
    for table_name in all_tables:
        namespace, _, name = table_name.partition(".")
        nodes.append({
            "id": _table_node_id(table_name),
            "kind": "table",
            "name": table_name,
            "displayName": name,
            "namespace": namespace.lower(),
            "attributes": {
                "layer": namespace,
                "dwfBoundary": is_dwf_table(table_name),
                "source": f"dwp.{program_table}",
            },
        })

    edges = []
    for job_name, tables in sorted(tables_by_job.items()):
        if job_name not in all_jobs:
            continue
        for table_name in sorted(tables):
            edge_id = f"edge:job_output:{_stable_id(job_name, table_name)}"
            edges.append({
                "id": edge_id,
                "sourceId": _task_node_id(job_name),
                "targetId": _table_node_id(table_name),
                "kind": "task_writes_table",
                "evidence": {
                    "type": "job_program_mapping",
                    "sourceRecordId": f"{program_table}:{_stable_id(job_name, table_name)}",
                    "description": f"{job_name} 通过 {program_table} 映射到结果表 {table_name}",
                },
                "confidence": "high",
                "generatedAt": generated_at,
                "diagnostics": [],
            })

    for downstream_job, job_dependencies in sorted(dependencies.items()):
        for upstream_job, dependency_type in job_dependencies:
            upstream_tables = sorted(tables_by_job.get(upstream_job, set()))
            if upstream_tables:
                for table_name in upstream_tables:
                    edge_id = f"edge:table_input:{_stable_id(table_name, downstream_job, dependency_type)}"
                    edges.append({
                        "id": edge_id,
                        "sourceId": _table_node_id(table_name),
                        "targetId": _task_node_id(downstream_job),
                        "kind": "task_reads_table",
                        "evidence": {
                            "type": "job_dependency_metadata",
                            "sourceRecordId": f"{job_table}:{_stable_id(downstream_job, upstream_job, dependency_type)}",
                            "description": (
                                f"依赖类型 {dependency_type}：{downstream_job} 依赖 "
                                f"{upstream_job} 的结果表 {table_name}"
                            ),
                        },
                        "confidence": "high",
                        "generatedAt": generated_at,
                        "diagnostics": [],
                    })
            else:
                edge_id = f"edge:job_dependency:{_stable_id(upstream_job, downstream_job, dependency_type)}"
                edges.append({
                    "id": edge_id,
                    "sourceId": _task_node_id(upstream_job),
                    "targetId": _task_node_id(downstream_job),
                    "kind": "task_precedes_task",
                    "evidence": {
                        "type": "job_dependency_metadata",
                        "sourceRecordId": f"{job_table}:{_stable_id(downstream_job, upstream_job, dependency_type)}",
                        "description": f"依赖类型 {dependency_type}；上游作业暂无结果表映射",
                    },
                    "confidence": "medium",
                    "generatedAt": generated_at,
                    "diagnostics": job_diagnostics.get(upstream_job, []),
                })

    diagnostics = [
        diagnostic
        for job_name in sorted(job_diagnostics)
        for diagnostic in job_diagnostics[job_name]
    ]
    return {
        "snapshotId": snapshot_id,
        "generatedAt": generated_at,
        "generator": {"name": f"{job_table}+{program_table}-collector", "version": "2.0"},
        "nodes": nodes,
        "edges": edges,
        "diagnostics": diagnostics,
    }


def load_source_rows(profile, *, job_table=None, program_table=None):
    tables = resolve_scheduler_tables(job_table, program_table)
    _, job_rows = fetch_all(profile, job_sql(tables.job_table))
    _, table_job_rows = fetch_all(profile, program_sql(tables.job_table, tables.program_table))
    return job_rows, table_job_rows


def publish_snapshot(profile, snapshot):
    with database_transaction():
        execute_sql(
            profile,
            "LOCK TABLE dwp.p_lineage_snapshot IN EXCLUSIVE MODE",
            autocommit=False,
        )
        execute_sql(profile, """
INSERT INTO dwp.p_lineage_snapshot
    (snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code)
VALUES (?, ?, ?, ?, ?, 'INACTIVE')
""", autocommit=False, params=[
            snapshot["snapshotId"],
            snapshot["generatedAt"],
            snapshot["generator"]["name"],
            snapshot["generator"]["version"],
            snapshot["snapshotId"],
        ])
        execute_many(profile, """
INSERT INTO dwp.p_lineage_node
    (snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json)
VALUES (?, ?, ?, ?, ?, ?, ?)
""", [
            (
                snapshot["snapshotId"], node["id"], node["kind"], node["name"],
                node["displayName"], node["namespace"],
                json.dumps(node["attributes"], ensure_ascii=False),
            )
            for node in snapshot["nodes"]
        ], autocommit=False)
        execute_many(profile, """
INSERT INTO dwp.p_lineage_edge
    (snapshot_id, edge_id, source_node_id, target_node_id, kind_code, evidence_type,
     source_record_id, evidence_description, confidence_code, generated_at, diagnostics_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", [
            (
                snapshot["snapshotId"], edge["id"], edge["sourceId"], edge["targetId"],
                edge["kind"], edge["evidence"]["type"], edge["evidence"]["sourceRecordId"],
                edge["evidence"]["description"], edge["confidence"], edge["generatedAt"],
                json.dumps(edge["diagnostics"], ensure_ascii=False),
            )
            for edge in snapshot["edges"]
        ], autocommit=False)
        execute_sql(
            profile,
            "UPDATE dwp.p_lineage_snapshot SET status_code = 'INACTIVE' WHERE status_code = 'ACTIVE'",
            autocommit=False,
        )
        execute_sql(
            profile,
            "UPDATE dwp.p_lineage_snapshot SET status_code = 'ACTIVE' WHERE snapshot_id = ?",
            autocommit=False,
            params=[snapshot["snapshotId"]],
        )


def collect_and_publish(profile, *, dry_run=False):
    job_rows, table_job_rows = load_source_rows(profile)
    snapshot = build_snapshot(job_rows, table_job_rows)
    if not dry_run:
        publish_snapshot(profile, snapshot)
    return snapshot
