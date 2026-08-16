"""Deterministic lineage graph used by the local/test seed command."""

from __future__ import annotations

TEST_PREFIX = "TEST_LIN_"
SNAPSHOT_ID = "TEST_LIN_SNAPSHOT_V1"
GENERATED_AT = "2026-07-13T00:00:00Z"


def _table(layer, name, display_name=None):
    return {
        "id": f"table:{layer.lower()}:{name}", "kind": "table", "name": name,
        "displayName": display_name or name, "namespace": layer.lower(),
        "attributes": {"layer": layer},
    }


def _task(name):
    return {
        "id": f"task:{name.lower()}", "kind": "task", "name": name,
        "displayName": name, "namespace": "scheduler",
        "attributes": {"plan": "TEST_LIN_DAILY", "status": "enabled"},
    }


def _edge(source, target, kind, number):
    return {
        "id": f"edge:{TEST_PREFIX}{number:03d}", "sourceId": source, "targetId": target,
        "kind": kind,
        "evidence": {"type": "test_lineage_seed", "sourceRecordId": f"{SNAPSHOT_ID}:{number}", "description": "deterministic test lineage"},
        "confidence": "high", "generatedAt": GENERATED_AT, "diagnostics": [],
    }


def build_test_snapshot():
    """Return a reproducible 64-table, 59-task, 120-edge graph.

    The three named roots cover the normal member path, multi-source fan-in,
    and wide fan-out paths used by the lineage page.
    """
    nodes, edges = [], []
    edge_number = 1

    def connect(source, target, kind):
        nonlocal edge_number
        edges.append(_edge(source, target, kind, edge_number)); edge_number += 1

    # Member chain: several sources flow through DWF_MEMBER_PROFILE and then fan out.
    member_sources = [f"{TEST_PREFIX}ODS_MEMBER_{index:02d}" for index in range(1, 9)]
    member_tasks = [f"{TEST_PREFIX}JOB_LOAD_MEMBER_{index:02d}" for index in range(1, 9)]
    nodes.extend(_table("ODS", name) for name in member_sources)
    nodes.extend(_task(name) for name in member_tasks)
    dwf_member = f"{TEST_PREFIX}DWF_MEMBER_PROFILE"
    nodes.append(_table("DWF", dwf_member, "TEST_LIN DWF member profile"))
    for source, task in zip(member_sources, member_tasks):
        connect(f"table:ods:{source}", f"task:{task.lower()}", "task_reads_table")
        connect(f"task:{task.lower()}", f"table:dwf:{dwf_member}", "task_writes_table")

    profile_task = f"{TEST_PREFIX}JOB_BUILD_MEMBER_PROFILE"
    profile_table = f"{TEST_PREFIX}DWM_MEMBER_PROFILE"
    summary_task = f"{TEST_PREFIX}JOB_BUILD_MEMBER_SUMMARY"
    summary_table = f"{TEST_PREFIX}DWP_MEMBER_SUMMARY"
    nodes.extend((_task(profile_task), _table("DWM", profile_table), _task(summary_task), _table("DWP", summary_table)))
    connect(f"table:dwf:{dwf_member}", f"task:{profile_task.lower()}", "task_reads_table")
    connect(f"task:{profile_task.lower()}", f"table:dwm:{profile_table}", "task_writes_table")
    connect(f"table:dwm:{profile_table}", f"task:{summary_task.lower()}", "task_reads_table")
    connect(f"task:{summary_task.lower()}", f"table:dwp:{summary_table}", "task_writes_table")

    # A shared dimension fans out to eight processing tasks and result tables.
    shared = f"{TEST_PREFIX}DIM_CUSTOMER"
    nodes.append(_table("DIM", shared))
    for index in range(1, 9):
        task, table = f"{TEST_PREFIX}JOB_CUSTOMER_BRANCH_{index:02d}", f"{TEST_PREFIX}DWM_CUSTOMER_BRANCH_{index:02d}"
        nodes.extend((_task(task), _table("DWM", table)))
        connect(f"table:dim:{shared}", f"task:{task.lower()}", "task_reads_table")
        connect(f"task:{task.lower()}", f"table:dwm:{table}", "task_writes_table")

    # Ten ODS inputs converge through three DWF tables into one DWM table.
    aggregate_task, aggregate_table = f"{TEST_PREFIX}JOB_BUILD_MULTI_SOURCE", f"{TEST_PREFIX}DWM_MULTI_SOURCE"
    nodes.extend((_task(aggregate_task), _table("DWM", aggregate_table)))
    for index in range(1, 11):
        source, task, target = (f"{TEST_PREFIX}ODS_MULTI_{index:02d}", f"{TEST_PREFIX}JOB_CLEAN_MULTI_{index:02d}", f"{TEST_PREFIX}DWF_MULTI_{(index - 1) % 3 + 1}")
        nodes.extend((_table("ODS", source), _task(task)))
        if not any(node["name"] == target for node in nodes): nodes.append(_table("DWF", target))
        connect(f"table:ods:{source}", f"task:{task.lower()}", "task_reads_table")
        connect(f"task:{task.lower()}", f"table:dwf:{target}", "task_writes_table")
    for index in range(1, 4):
        target = f"{TEST_PREFIX}DWF_MULTI_{index}"
        connect(f"table:dwf:{target}", f"task:{aggregate_task.lower()}", "task_reads_table")
    connect(f"task:{aggregate_task.lower()}", f"table:dwm:{aggregate_table}", "task_writes_table")

    # Continue the member chain through API and report outputs for depth >= 5.
    for kind, layer in (("API", "API"), ("REPORT", "REPORT"), ("PUSH", "PUSH")):
        task, table = f"{TEST_PREFIX}JOB_PUBLISH_{kind}", f"{TEST_PREFIX}{kind}_MEMBER"
        nodes.extend((_task(task), _table(layer, table)))
        connect(f"table:dwp:{summary_table}", f"task:{task.lower()}", "task_reads_table")
        connect(f"task:{task.lower()}", f"table:{layer.lower()}:{table}", "task_writes_table")

    # Additional report tables retain a broad, visually useful graph.
    for index in range(1, 28):
        task, table = f"{TEST_PREFIX}JOB_REPORT_{index:02d}", f"{TEST_PREFIX}REPORT_{index:02d}"
        nodes.extend((_task(task), _table("REPORT", table)))
        connect(f"table:dwp:{summary_table}", f"task:{task.lower()}", "task_reads_table")
        connect(f"task:{task.lower()}", f"table:report:{table}", "task_writes_table")

    return {
        "snapshotId": SNAPSHOT_ID, "generatedAt": GENERATED_AT,
        "generator": {"name": "lineage-test-seed", "version": "1.0"},
        "nodes": nodes, "edges": edges, "diagnostics": [],
    }


def test_snapshot_counts():
    snapshot = build_test_snapshot()
    return {"tables": sum(node["kind"] == "table" for node in snapshot["nodes"]), "tasks": sum(node["kind"] == "task" for node in snapshot["nodes"]), "edges": len(snapshot["edges"])}
