"""Bounded database reads for persistent lineage snapshots.

The reader deliberately exposes adjacency and lookup operations rather than a
whole-snapshot loader. Callers own one ``database_transaction`` around a
request so ACTIVE metadata and all subsequent bounded reads share a stable
snapshot identity.
"""

from __future__ import annotations

from sqlalchemy import and_, case, exists, func, select

from ..db.tables import lineage_edge, lineage_node, lineage_snapshot


# Portal search paths use "!" as a portable single-character ``LIKE`` escape
# token (see ``services.search_provider.KeywordSearchProvider.LIKE_ESCAPE``).
# GaussDB/DWS parses ``ESCAPE '\\'`` as an invalid escape string, so lineage
# search reuses the same policy instead of a backslash literal.
LINEAGE_LIKE_ESCAPE_CHAR = "!"


def escape_like_operand(value: str, escape_char: str = LINEAGE_LIKE_ESCAPE_CHAR) -> str:
    """Escape LIKE wildcards so user input is matched literally.

    The escape token is escaped first; otherwise a user-supplied token could
    change the meaning of a later wildcard escape (e.g. ``!_``).
    """
    return (
        value.replace(escape_char, escape_char * 2)
        .replace("%", f"{escape_char}%")
        .replace("_", f"{escape_char}_")
    )


_NODE_COLUMNS = (
    lineage_node.c.node_id,
    lineage_node.c.kind_code,
    lineage_node.c.node_name,
    lineage_node.c.display_name,
    lineage_node.c.namespace_name,
    lineage_node.c.attributes_json,
)
_EDGE_COLUMNS = (
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


class LineageDatabaseReader:
    """Small SQLAlchemy Core query surface for an already-selected profile."""

    def __init__(self, db):
        self._db = db

    def active_snapshot(self):
        rows = self._db.fetch_rows(
            select(
                lineage_snapshot.c.snapshot_id,
                lineage_snapshot.c.generated_at,
                lineage_snapshot.c.generator_name,
                lineage_snapshot.c.generator_version,
            )
            .where(lineage_snapshot.c.status_code == "ACTIVE")
            .order_by(
                lineage_snapshot.c.generated_at.desc(),
                lineage_snapshot.c.snapshot_id.desc(),
            )
            .limit(1)
        )
        return rows[0] if rows else None

    def counts(self, snapshot_id: str) -> tuple[int, int]:
        node_rows = self._db.fetch_rows(
            select(func.count().label("row_count")).select_from(lineage_node).where(
                lineage_node.c.snapshot_id == snapshot_id
            )
        )
        edge_rows = self._db.fetch_rows(
            select(func.count().label("row_count")).select_from(lineage_edge).where(
                lineage_edge.c.snapshot_id == snapshot_id
            )
        )
        return (
            int(node_rows[0]["row_count"] if node_rows else 0),
            int(edge_rows[0]["row_count"] if edge_rows else 0),
        )

    def default_root_id(self, snapshot_id: str) -> str | None:
        """Choose a deterministic table-first root without loading the graph.

        Connectivity and layer preference are evaluated by portable SQL
        expressions. The historical Python ranking also used exact degree
        counts and attributes_json.layer; avoiding those graph-wide values is
        intentional. Namespace is the stable layer fallback for this bounded
        root heuristic.
        """
        node = lineage_node
        has_incoming = exists(
            select(lineage_edge.c.edge_id).where(
                lineage_edge.c.snapshot_id == snapshot_id,
                lineage_edge.c.target_node_id == node.c.node_id,
            )
        )
        has_outgoing = exists(
            select(lineage_edge.c.edge_id).where(
                lineage_edge.c.snapshot_id == snapshot_id,
                lineage_edge.c.source_node_id == node.c.node_id,
            )
        )
        connected_rank = case((and_(has_incoming, has_outgoing), 0), else_=1)
        kind_rank = case((node.c.kind_code == "table", 0), else_=1)
        layer = func.upper(func.coalesce(node.c.namespace_name, ""))
        layer_rank = case(
            (layer.in_(("DWF", "DWS_DWF")), 0),
            (layer.in_(("DWM", "DWS_DWM")), 1),
            (layer.in_(("DWP", "DWS_DWP")), 2),
            (layer == "DIM", 3),
            (layer == "ODS", 4),
            (layer == "API", 5),
            (layer == "REPORT", 6),
            (layer == "PUSH", 7),
            else_=8,
        )
        rows = self._db.fetch_rows(
            select(node.c.node_id)
            .where(node.c.snapshot_id == snapshot_id)
            .order_by(kind_rank, connected_rank, layer_rank, node.c.node_id)
            .limit(1)
        )
        return rows[0]["node_id"] if rows else None

    def search_nodes(self, snapshot_id: str, name_pattern: str, limit: int) -> list[dict]:
        return self._db.fetch_rows(
            select(*_NODE_COLUMNS)
            .where(
                lineage_node.c.snapshot_id == snapshot_id,
                lineage_node.c.kind_code.in_(("table", "task")),
                func.lower(lineage_node.c.node_name).like(
                    name_pattern, escape=LINEAGE_LIKE_ESCAPE_CHAR
                ),
            )
            .order_by(lineage_node.c.node_id)
            .limit(limit)
        )

    def node(self, snapshot_id: str, node_id: str) -> dict | None:
        rows = self._db.fetch_rows(
            select(*_NODE_COLUMNS)
            .where(
                lineage_node.c.snapshot_id == snapshot_id,
                lineage_node.c.node_id == node_id,
            )
            .limit(1)
        )
        return rows[0] if rows else None

    def adjacent(self, snapshot_id: str, node_ids: list[str], direction: str, limit: int) -> list[dict]:
        """Fetch one bounded adjacency batch plus the opposite endpoint node."""
        if not node_ids or limit <= 0:
            return []
        neighbor = lineage_node.alias("lineage_neighbor")
        if direction == "downstream":
            endpoint_column = lineage_edge.c.target_node_id
            condition = lineage_edge.c.source_node_id.in_(node_ids)
        elif direction == "upstream":
            endpoint_column = lineage_edge.c.source_node_id
            condition = lineage_edge.c.target_node_id.in_(node_ids)
        else:
            raise ValueError("direction must be upstream or downstream")
        join_condition = and_(
            neighbor.c.snapshot_id == lineage_edge.c.snapshot_id,
            neighbor.c.node_id == endpoint_column,
        )
        columns = [column.label(f"edge_{column.name}") for column in _EDGE_COLUMNS]
        columns.extend(
            (
                neighbor.c.node_id.label("node_id"),
                neighbor.c.kind_code.label("node_kind_code"),
                neighbor.c.node_name.label("node_name"),
                neighbor.c.display_name.label("node_display_name"),
                neighbor.c.namespace_name.label("node_namespace_name"),
                neighbor.c.attributes_json.label("node_attributes_json"),
            )
        )
        statement = (
            select(*columns)
            .select_from(lineage_edge.join(neighbor, join_condition))
            .where(lineage_edge.c.snapshot_id == snapshot_id, condition)
            .order_by(lineage_edge.c.edge_id)
            .limit(limit)
        )
        return self._db.fetch_rows(statement)


__all__ = ["LINEAGE_LIKE_ESCAPE_CHAR", "LineageDatabaseReader", "escape_like_operand"]
