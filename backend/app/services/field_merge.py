"""Deterministic field identity reconciliation shared by ingestion and edits.

The frozen contract behind this module is Epic #257 / #259 and the canonical
Ownership / Merge Matrix in #260 §8:

* historical identity is ``p_asset_field.field_id``; IDs are allocated
  monotonically and never reused;
* active matching key is ``(asset_id, field_name.casefold())`` over rows with
  ``is_deleted = 'N'``; deleted historical rows never match;
* there is no upstream field-level stable key, so a rename is always a soft
  delete of the old name plus an insert with a brand-new ``field_id``;
* ``field_id`` allocation must not reuse the ID of a deleted field, therefore
  a name that disappears and later returns receives a new ``field_id``;
* compare / merge only ever use the source-owned projection; portal-owned
  columns (``field_cn_name`` / ``enum_desc``) are preserved by callers.

The module is deliberately pure: it maps persisted rows and incoming payload
values into a deterministic plan and never touches the database, so both the
Metadata Ingestion service and the manual Assets CRUD path share exactly one
matching / lifecycle implementation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


class FieldIdentityConflict(ValueError):
    """Active rows or incoming fields are ambiguous under the matching key."""


def normalize_field_name(value: str | None) -> str:
    """V1 active matching key component: case-insensitive, trimmed name."""
    return str(value or "").strip().casefold()


def _flag(value: Any, *, default: bool = False) -> bool:
    text = str(value or "").strip().upper()
    if not text:
        return default
    return text == "Y"


@dataclass(frozen=True)
class ActiveField:
    """A live ``p_asset_field`` row (``is_deleted = 'N'``)."""

    field_id: int
    field_name: str
    data_type: str | None
    nullable: bool
    pk: bool
    part: bool
    field_order: int
    field_desc: str | None = None
    field_cn_name: str | None = None
    enum_desc: str | None = None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> ActiveField:
        """Build from a SQLAlchemy Core row using canonical column names."""
        return cls(
            field_id=int(row["field_id"]),
            field_name=str(row.get("field_name") or ""),
            data_type=row.get("data_type"),
            nullable=_flag(row.get("nullable_flag"), default=True),
            pk=_flag(row.get("pk_flag")),
            part=_flag(row.get("partition_flag")),
            field_order=int(row.get("field_order") or 0),
            field_desc=row.get("field_desc"),
            field_cn_name=row.get("field_cn_name"),
            enum_desc=row.get("enum_desc"),
        )

    @property
    def key(self) -> str:
        return normalize_field_name(self.field_name)

    @property
    def source_projection(self) -> tuple[Any, ...]:
        """Source-owned compare projection (#260 §8.4); portal columns excluded."""
        return (
            self.field_name,
            self.data_type,
            self.nullable,
            self.pk,
            self.part,
            self.field_order,
            self.field_desc,
        )


@dataclass(frozen=True)
class IncomingField:
    """One field from an authoritative source payload or a manual edit.

    ``None`` means the wire key was absent for that optional attribute; the
    resolution rules in :func:`resolve_source_field` turn that into
    "preserve existing" for updates and "contract default" for inserts.
    ``description_present`` distinguishes an absent description from an
    explicit ``null`` / empty-string clear.
    """

    name: str
    data_type: str
    nullable: bool | None = None
    pk: bool | None = None
    part: bool | None = None
    field_order: int | None = None
    description: str | None = None
    description_present: bool = False
    cn: str | None = None
    enum: str | None = None

    @property
    def key(self) -> str:
        return normalize_field_name(self.name)


@dataclass(frozen=True)
class MergedField:
    """Effective source-owned values for one field after presence resolution."""

    field_id: int | None
    field_name: str
    data_type: str
    nullable: bool
    pk: bool
    part: bool
    field_order: int
    field_desc: str | None

    @property
    def projection(self) -> tuple[Any, ...]:
        return (
            self.field_name,
            self.data_type,
            self.nullable,
            self.pk,
            self.part,
            self.field_order,
            self.field_desc,
        )


@dataclass(frozen=True)
class FieldUpdate:
    current: ActiveField
    incoming: IncomingField
    resolved: MergedField

    @property
    def changed(self) -> bool:
        return self.current.source_projection != self.resolved.projection


@dataclass(frozen=True)
class FieldInsert:
    incoming: IncomingField
    resolved: MergedField


@dataclass(frozen=True)
class FieldCollectionPlan:
    """Identity plan before column-level value resolution."""

    matched: tuple[tuple[ActiveField, IncomingField], ...]
    inserted: tuple[IncomingField, ...]
    deleted: tuple[ActiveField, ...]


@dataclass(frozen=True)
class SourceMergePlan:
    """Effective source-owned merge plan for one asset's active fields."""

    updates: tuple[FieldUpdate, ...]
    inserts: tuple[FieldInsert, ...]
    deletes: tuple[ActiveField, ...]

    @property
    def source_changed(self) -> bool:
        return bool(self.inserts or self.deletes) or any(
            update.changed for update in self.updates
        )

    def active_count_after(self, active_before: int) -> int:
        return active_before - len(self.deletes) + len(self.inserts)


def plan_field_collection(
    active: Sequence[ActiveField],
    incoming: Sequence[IncomingField],
) -> FieldCollectionPlan:
    """Match incoming fields against active rows by normalized name.

    Deleted historical rows must not be passed in ``active``. Duplicate
    normalized keys are a deterministic conflict instead of a silent
    first-match.
    """
    indexed: dict[str, ActiveField] = {}
    for row in active:
        if row.key in indexed:
            raise FieldIdentityConflict(
                f"active field identity is ambiguous: {row.field_name!r}"
            )
        indexed[row.key] = row

    seen: set[str] = set()
    matched: list[tuple[ActiveField, IncomingField]] = []
    inserted: list[IncomingField] = []
    matched_keys: set[str] = set()
    for field in incoming:
        key = field.key
        if key in seen:
            raise FieldIdentityConflict(
                f"field names must be unique per asset: {field.name!r}"
            )
        seen.add(key)
        current = indexed.get(key)
        if current is None:
            inserted.append(field)
        else:
            matched_keys.add(key)
            matched.append((current, field))

    deleted = tuple(row for row in active if row.key not in matched_keys)
    return FieldCollectionPlan(tuple(matched), tuple(inserted), deleted)


def resolve_source_field(
    current: ActiveField | None,
    incoming: IncomingField,
    *,
    fallback_order: int,
) -> MergedField:
    """Resolve source-owned values using #260 presence / three-state rules.

    ``incoming.description`` is the normalized wire value (``None`` for an
    absent key or an explicit clear); ``description_present`` decides whether
    an update preserves or writes ``field_desc``. Descriptions never fall back
    to the field name during merge / compare.
    """
    if current is None:
        return MergedField(
            field_id=None,
            field_name=incoming.name,
            data_type=incoming.data_type,
            nullable=incoming.nullable if incoming.nullable is not None else True,
            pk=incoming.pk if incoming.pk is not None else False,
            part=incoming.part if incoming.part is not None else False,
            field_order=fallback_order,
            field_desc=incoming.description,
        )
    return MergedField(
        field_id=current.field_id,
        field_name=incoming.name,
        data_type=incoming.data_type,
        nullable=incoming.nullable if incoming.nullable is not None else current.nullable,
        pk=incoming.pk if incoming.pk is not None else current.pk,
        part=incoming.part if incoming.part is not None else current.part,
        field_order=incoming.field_order if incoming.field_order is not None else current.field_order,
        field_desc=incoming.description if incoming.description_present else current.field_desc,
    )


def plan_source_merge(
    active: Sequence[ActiveField],
    incoming: Sequence[IncomingField],
) -> SourceMergePlan:
    """Build the effective source-owned merge plan for an authoritative payload.

    Insert order is deterministic when ``ordinalPosition`` is absent: it
    continues after the highest order already present (stored or explicitly
    provided in the same payload). Existing rows are never reordered just
    because the JSON array order changed.
    """
    collection = plan_field_collection(active, incoming)
    base_order = max([row.field_order for row in active] + [0])
    inserts: list[FieldInsert] = []
    for field in collection.inserted:
        order = field.field_order if field.field_order is not None else base_order + 1
        base_order = max(base_order, order)
        inserts.append(
            FieldInsert(field, resolve_source_field(None, field, fallback_order=order))
        )
    updates = tuple(
        FieldUpdate(
            current,
            field,
            resolve_source_field(current, field, fallback_order=current.field_order),
        )
        for current, field in collection.matched
    )
    return SourceMergePlan(updates, tuple(inserts), collection.deleted)


EMPTY_SOURCE_MERGE_PLAN = SourceMergePlan((), (), ())


__all__ = [
    "ActiveField",
    "EMPTY_SOURCE_MERGE_PLAN",
    "FieldCollectionPlan",
    "FieldIdentityConflict",
    "FieldInsert",
    "FieldUpdate",
    "IncomingField",
    "MergedField",
    "SourceMergePlan",
    "normalize_field_name",
    "plan_field_collection",
    "plan_source_merge",
    "resolve_source_field",
]
