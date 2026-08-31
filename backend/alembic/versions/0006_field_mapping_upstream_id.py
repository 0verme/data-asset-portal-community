"""Make field-mapping ownership an explicit upstream-system relation.

The pre-0006 mapping query used the shared data-source name (and, in some
paths, its surrogate key) as the source-system identity.  The table already
had an optional ``upstream_system_id`` column, so this revision promotes that
existing column to the canonical relation instead of adding a second identity
column.

The backfill is deliberately conservative.  A legacy row can be assigned from
``data_source_id`` only when exactly one upstream system points at that data
source.  Missing, conflicting, or ambiguous rows abort the migration with the
row details; this revision never chooses a first/min/max candidate.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_field_mapping_upstream_id"
down_revision = "0005_rbac_persistence"
branch_labels = None
depends_on = None

UPSTREAM_FK_NAME = "fk_p_field_mapping_table_upstream"
UPSTREAM_INDEX_NAME = "idx_p_field_mapping_table_uk_01"


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _table(name: str) -> sa.Table:
    return sa.Table(
        name,
        sa.MetaData(),
        autoload_with=op.get_bind(),
        schema=_schema(),
    )


def _as_int(value, *, label: str) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"字段映射迁移发现无效 {label}: {value!r}") from error


def _describe_system(row) -> str:
    return (
        f"system_pk={row.get('system_pk')}, "
        f"system_id={row.get('system_id')!r}, "
        f"system_abbr={row.get('system_abbr')!r}, "
        f"system_name={row.get('system_name')!r}"
    )


def _backfill_upstream_system_id() -> None:
    bind = op.get_bind()
    mapping = _table("p_field_mapping_table")
    upstream = _table("p_upstream_system")

    mapping_rows = bind.execute(
        sa.select(
            mapping.c.table_pk,
            mapping.c.data_source_id,
            mapping.c.upstream_system_id,
            mapping.c.source_table_name,
        ).order_by(mapping.c.table_pk)
    ).mappings().all()
    if not mapping_rows:
        return

    systems = bind.execute(
        sa.select(
            upstream.c.system_pk,
            upstream.c.data_source_id,
            upstream.c.system_id,
            upstream.c.system_abbr,
            upstream.c.system_name,
        ).order_by(upstream.c.system_pk)
    ).mappings().all()
    systems_by_pk = {}
    systems_by_data_source: dict[int, list] = {}
    for row in systems:
        system_pk = _as_int(row.get("system_pk"), label="system_pk")
        if system_pk is None:
            continue
        systems_by_pk[system_pk] = row
        data_source_id = _as_int(row.get("data_source_id"), label="data_source_id")
        if data_source_id is not None:
            systems_by_data_source.setdefault(data_source_id, []).append(row)

    updates: list[tuple[int, int]] = []
    errors: list[str] = []
    for row in mapping_rows:
        table_pk = row.get("table_pk")
        source_table = row.get("source_table_name")
        source_id = _as_int(row.get("data_source_id"), label="mapping.data_source_id")
        current_id = _as_int(row.get("upstream_system_id"), label="mapping.upstream_system_id")

        if current_id is not None:
            system = systems_by_pk.get(current_id)
            if system is None:
                errors.append(
                    f"table_pk={table_pk}, source_table={source_table!r}: "
                    f"upstream_system_id={current_id} 不存在"
                )
                continue
            system_source_id = _as_int(system.get("data_source_id"), label="upstream.data_source_id")
            if source_id is not None and system_source_id is not None and source_id != system_source_id:
                errors.append(
                    f"table_pk={table_pk}, source_table={source_table!r}: "
                    f"data_source_id={source_id} 与 {_describe_system(system)} 不一致"
                )
            continue

        candidates = systems_by_data_source.get(source_id, []) if source_id is not None else []
        if len(candidates) == 1:
            updates.append((int(table_pk), int(candidates[0]["system_pk"])))
            continue
        if not candidates:
            reason = "没有可唯一匹配的上游系统"
        else:
            reason = "存在多个候选上游系统：" + "; ".join(_describe_system(item) for item in candidates)
        errors.append(
            f"table_pk={table_pk}, source_table={source_table!r}, "
            f"data_source_id={source_id}: {reason}"
        )

    if errors:
        raise RuntimeError(
            "字段映射 upstream_system_id backfill 无法安全完成；"
            "请补充明确的上游系统关联后重试，未写入任何 backfill：\n"
            + "\n".join(errors)
        )

    for table_pk, system_pk in updates:
        bind.execute(
            sa.update(mapping)
            .where(mapping.c.table_pk == table_pk, mapping.c.upstream_system_id.is_(None))
            .values(upstream_system_id=system_pk)
        )


def _validate_mapping_keys() -> None:
    bind = op.get_bind()
    mapping = _table("p_field_mapping_table")
    duplicates = bind.execute(
        sa.select(
            mapping.c.upstream_system_id,
            mapping.c.source_table_name,
            sa.func.count().label("mapping_count"),
        )
        .group_by(mapping.c.upstream_system_id, mapping.c.source_table_name)
        .having(sa.func.count() > 1)
        .order_by(mapping.c.upstream_system_id, mapping.c.source_table_name)
    ).mappings().all()
    if duplicates:
        details = "; ".join(
            f"upstream_system_id={row['upstream_system_id']}, "
            f"source_table={row['source_table_name']!r}, count={row['mapping_count']}"
            for row in duplicates
        )
        raise RuntimeError(
            "字段映射存在重复的 upstream_system_id + source_table_name，"
            f"无法建立唯一约束：{details}"
        )


def _foreign_key_state() -> tuple[bool, bool]:
    inspector = sa.inspect(op.get_bind())
    foreign_keys = inspector.get_foreign_keys("p_field_mapping_table", schema=_schema())
    found_on_column = False
    correct = False
    for item in foreign_keys:
        columns = tuple(str(value).lower() for value in item.get("constrained_columns") or ())
        if columns != ("upstream_system_id",):
            continue
        found_on_column = True
        referred_table = str(item.get("referred_table") or "").lower()
        referred_columns = tuple(str(value).lower() for value in item.get("referred_columns") or ())
        if referred_table == "p_upstream_system" and referred_columns == ("system_pk",):
            correct = True
    if found_on_column and not correct:
        raise RuntimeError(
            "p_field_mapping_table.upstream_system_id 已存在但未指向 "
            "p_upstream_system.system_pk，拒绝覆盖现有外键"
        )
    return found_on_column, correct


def _index_exists() -> bool:
    inspector = sa.inspect(op.get_bind())
    for item in inspector.get_indexes("p_field_mapping_table", schema=_schema()):
        name = str(item.get("name") or "").lower()
        columns = tuple(str(value).lower() for value in item.get("column_names") or ())
        if name != UPSTREAM_INDEX_NAME.lower():
            continue
        if columns != ("upstream_system_id", "source_table_name") or not item.get("unique"):
            raise RuntimeError(f"{UPSTREAM_INDEX_NAME} 已存在但定义不符合稳定关联约束")
        return True
    return False


def _ensure_relation_shape() -> None:
    bind = op.get_bind()
    mapping = _table("p_field_mapping_table")
    inspector = sa.inspect(bind)
    upstream_column = next(
        item for item in inspector.get_columns("p_field_mapping_table", schema=_schema())
        if str(item.get("name") or "").lower() == "upstream_system_id"
    )
    data_source_column = next(
        item for item in inspector.get_columns("p_field_mapping_table", schema=_schema())
        if str(item.get("name") or "").lower() == "data_source_id"
    )
    _has_fk, correct_fk = _foreign_key_state()
    needs_upstream_not_null = bool(upstream_column.get("nullable"))
    needs_data_source_nullable = not bool(data_source_column.get("nullable"))

    if _dialect() == "sqlite" and (
        needs_upstream_not_null or needs_data_source_nullable or not correct_fk
    ):
        with op.batch_alter_table(
            "p_field_mapping_table",
            schema=_schema(),
            recreate="always",
        ) as batch:
            if needs_data_source_nullable:
                batch.alter_column(
                    "data_source_id",
                    existing_type=mapping.c.data_source_id.type,
                    nullable=True,
                )
            if needs_upstream_not_null:
                batch.alter_column(
                    "upstream_system_id",
                    existing_type=mapping.c.upstream_system_id.type,
                    nullable=False,
                )
            if not correct_fk:
                batch.create_foreign_key(
                    UPSTREAM_FK_NAME,
                    "p_upstream_system",
                    ["upstream_system_id"],
                    ["system_pk"],
                    referent_schema=_schema(),
                    ondelete="RESTRICT",
                )
    else:
        if needs_data_source_nullable:
            op.alter_column(
                "p_field_mapping_table",
                "data_source_id",
                existing_type=mapping.c.data_source_id.type,
                nullable=True,
                schema=_schema(),
            )
        if needs_upstream_not_null:
            op.alter_column(
                "p_field_mapping_table",
                "upstream_system_id",
                existing_type=mapping.c.upstream_system_id.type,
                nullable=False,
                schema=_schema(),
            )
        if not correct_fk:
            op.create_foreign_key(
                UPSTREAM_FK_NAME,
                "p_field_mapping_table",
                "p_upstream_system",
                ["upstream_system_id"],
                ["system_pk"],
                source_schema=_schema(),
                referent_schema=_schema(),
                ondelete="RESTRICT",
            )

    if not _index_exists():
        op.create_index(
            UPSTREAM_INDEX_NAME,
            "p_field_mapping_table",
            ["upstream_system_id", "source_table_name"],
            unique=True,
            schema=_schema(),
        )


def upgrade() -> None:
    _backfill_upstream_system_id()
    _validate_mapping_keys()
    _ensure_relation_shape()


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
