"""Bounded database reads for persistent lineage snapshots.

The reader deliberately exposes adjacency and lookup operations rather than a
whole-snapshot loader. Callers own one ``database_transaction`` around a
request so ACTIVE metadata and all subsequent bounded reads share a stable
snapshot identity.
"""

from __future__ import annotations

from sqlalchemy import and_, case, func, select

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


def _layer_rank_expression(node):
    layer = func.upper(func.coalesce(node.c.namespace_name, ""))
    return case(
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

        The historical ranking was one ``ORDER BY`` over every node with two
        correlated ``EXISTS`` probes per node; GaussDB/DWS executed that shape
        as ~17k nodes x 2 edge lookups and took ~67s on a 45k-edge snapshot.

        Candidates are now evaluated by bounded portable SQL in the same
        product priority order, short-circuiting on the first hit:

        1. connected table (has incoming and outgoing edges)
        2. any table
        3. connected node
        4. any node

        Connectivity is derived once per candidate query as two ``DISTINCT``
        edge-endpoint sets, so the snapshot's edges are scanned set-wise
        instead of probing edges per node. Layer ranking and node_id ordering
        are unchanged, and no query materializes the full snapshot.
        """
        node = lineage_node
        layer_rank = _layer_rank_expression(node)
        incoming_ids = (
            select(lineage_edge.c.target_node_id.label("node_id"))
            .where(lineage_edge.c.snapshot_id == snapshot_id)
            .distinct()
            .subquery("lineage_incoming_ids")
        )
        outgoing_ids = (
            select(lineage_edge.c.source_node_id.label("node_id"))
            .where(lineage_edge.c.snapshot_id == snapshot_id)
            .distinct()
            .subquery("lineage_outgoing_ids")
        )

        def connected_candidates(kind: str | None):
            statement = (
                select(node.c.node_id)
                .select_from(
                    incoming_ids.join(
                        outgoing_ids,
                        outgoing_ids.c.node_id == incoming_ids.c.node_id,
                    ).join(
                        node,
                        and_(
                            node.c.snapshot_id == snapshot_id,
                            node.c.node_id == incoming_ids.c.node_id,
                        ),
                    )
                )
                .order_by(layer_rank, node.c.node_id)
                .limit(1)
            )
            if kind is not None:
                statement = statement.where(node.c.kind_code == kind)
            return statement

        def ranked_candidates(kind: str | None):
            statement = (
                select(node.c.node_id)
                .where(node.c.snapshot_id == snapshot_id)
                .order_by(layer_rank, node.c.node_id)
                .limit(1)
            )
            if kind is not None:
                statement = statement.where(node.c.kind_code == kind)
            return statement

        candidates = (
            connected_candidates("table"),
            ranked_candidates("table"),
            connected_candidates(None),
            ranked_candidates(None),
        )
        for statement in candidates:
            rows = self._db.fetch_rows(statement)
            if rows:
                return rows[0]["node_id"]
        return None

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
