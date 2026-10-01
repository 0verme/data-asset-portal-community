"""Ordered JDBC revision runner for GaussDB/DWS.

The runner drives :mod:`backend.app.migrations.dws_revisions` over the raw
JayDeBeApi/JPype connection returned by ``connect_with_profile``.  It does not
create a second DWS connection configuration and it does not use Alembic's
online engine, which the DWS provider intentionally does not have.

Contract enforced here:

* the ledger is a known revision on the repository's single head;
* every missing revision is inspected against the physical schema before it
  runs (``APPLIED`` adopts, ``NOT_APPLIED`` applies, ``CONFLICT`` fails closed);
* a revision is stamped only after its post-condition is confirmed;
* ``head`` is a no-op and a repeated ``apply`` never replays DDL or DML.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .dws_revisions import (
    DwsMigrationError,
    DwsRevisionContext,
    RevisionInspection,
    RevisionState,
    get_adapter,
)
from .schema import (
    SCHEMA_ROOT,
    SchemaModel,
    baseline_schema,
    current_revision,
    reflect_schema,
    stamp_revision,
)

BACKEND = Path(__file__).resolve().parents[2]

REPAIR_HINTS: dict[str, tuple[str, ...]] = {
    "0003_open_repository_modules": (
        "resolve the partially created open-module tables before retrying",
    ),
    "0004_metadata_ingestion_identity": (
        "complete or revert the asset identity columns/unique keys explicitly; "
        "the runner never guesses between the legacy and the new shape",
    ),
    "0005_rbac_persistence": (
        "complete or drop the partial RBAC table set explicitly before retrying",
    ),
    "0006_field_mapping_upstream_id": (
        "resolve ambiguous or duplicate mapping rows, or set "
        "p_field_mapping_table.upstream_system_id explicitly",
    ),
    "0007_binary_status_contract": (
        "normalize unsupported p_manual_code_table.status_code values explicitly",
    ),
    "0008_indicator_semantic_contract": (
        "complete the indicator semantic columns together with "
        "idx_p_indicator_semantic_ref, or revert them explicitly",
    ),
    "0010_field_mapping_identity": (
        "remove the obsolete source-only unique index explicitly, then retry",
    ),
}


@dataclass(frozen=True)
class RevisionPlanItem:
    revision: str
    state: RevisionState | None
    action: str
    summary: str = ""
    details: tuple[str, ...] = ()


@dataclass(frozen=True)
class RevisionResult:
    revision: str
    action: str
    summary: str = ""


def _script_directory():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))


def repository_head() -> str:
    head = _script_directory().get_current_head()
    if head is None:
        raise RuntimeError("repository has no Alembic migration head")
    return head


def revision_chain(start: str, head: str) -> list[str]:
    """Return the ordered revisions strictly after *start* up to *head*."""
    script = _script_directory()
    try:
        script.get_revision(start)
    except Exception as exc:
        raise DwsMigrationError(
            start,
            observed=f"ledger revision {start!r} is not known to this repository",
            reason="unknown revisions are never guessed or modified",
            repairs=("restore a valid ledger value from a backup before retrying",),
        ) from exc
    if start == head:
        return []
    return [item.revision for item in reversed(list(script.iterate_revisions(head, start)))]


def _reflect(connection, config: dict, root: Path) -> SchemaModel:
    return reflect_schema(connection, config, baseline_schema("dws", root))


def inspect_revision(
    connection,
    config: dict,
    revision: str,
    *,
    model: SchemaModel | None = None,
    root: Path = SCHEMA_ROOT,
) -> RevisionInspection:
    adapter = get_adapter(revision)
    if adapter is None:
        raise DwsMigrationError(
            revision,
            observed="no DWS adapter is registered for this revision",
            reason=(
                "an existing DWS deployment cannot advance past a revision "
                "without an explicit adapter"
            ),
            repairs=(
                "add a DWS adapter for the revision before upgrading an existing "
                "GaussDB/DWS deployment",
            ),
        )
    if model is None:
        model = _reflect(connection, config, root)
    context = DwsRevisionContext(
        connection=connection,
        config=config,
        model=model,
        root=root,
        revision=revision,
    )
    return adapter.inspect(context)


def plan_revisions(
    connection,
    config: dict,
    start: str,
    head: str,
    *,
    root: Path = SCHEMA_ROOT,
) -> list[RevisionPlanItem]:
    """Read-only per-revision plan for an existing DWS deployment.

    The plan is inspected against the *current* physical schema.  Once a
    revision is pending, later revisions whose state cannot be conclusive yet
    are reported as ``pending`` instead of a misleading conflict.
    """
    chain = revision_chain(start, head)
    if not chain:
        return []
    model = _reflect(connection, config, root)
    items: list[RevisionPlanItem] = []
    pending_predecessor = False
    for revision in chain:
        inspection = inspect_revision(
            connection, config, revision, model=model, root=root
        )
        if inspection.state is RevisionState.APPLIED:
            action = "adopt"
        elif inspection.state is RevisionState.NOT_APPLIED:
            action = "apply"
            pending_predecessor = True
        elif pending_predecessor:
            action = "pending"
        else:
            action = "conflict"
        items.append(
            RevisionPlanItem(
                revision,
                inspection.state,
                action,
                inspection.summary,
                inspection.details,
            )
        )
    return items


def _safe_rollback(connection) -> None:
    try:
        connection.rollback()
    except Exception:
        pass


def _conflict_error(revision: str, inspection: RevisionInspection) -> DwsMigrationError:
    return DwsMigrationError(
        revision,
        observed=inspection.summary,
        reason=(
            "the physical state is neither the revision's pre-condition nor its "
            "post-condition; the runner fails closed instead of guessing, "
            "deleting or rebuilding"
        ),
        details=inspection.details,
        repairs=REPAIR_HINTS.get(revision, ()),
    )


def apply_revisions(
    connection,
    config: dict,
    start: str,
    head: str,
    *,
    root: Path = SCHEMA_ROOT,
    on_revision: Callable[[RevisionResult], None] | None = None,
) -> list[RevisionResult]:
    """Apply/adopt every revision after *start* up to *head*.

    The ledger is advanced to *start* only when it does not exist yet (a fresh
    baseline was just executed and verified by the caller).  Every following
    revision is stamped only after its post-condition is confirmed.
    """
    ledger = current_revision(connection, config)
    if ledger is None:
        stamp_revision(connection, config, start)
        connection.commit()
    elif ledger != start:
        raise DwsMigrationError(
            start,
            observed=f"ledger revision changed during migration: {ledger!r}",
            reason="the runner refuses to operate on a different ledger revision",
        )

    chain = revision_chain(start, head)
    results: list[RevisionResult] = []
    for revision in chain:
        adapter = get_adapter(revision)
        if adapter is None:
            raise DwsMigrationError(
                revision,
                observed="no DWS adapter is registered for this revision",
                reason="existing DWS deployments require an explicit adapter per revision",
            )
        model = _reflect(connection, config, root)
        inspection = inspect_revision(
            connection, config, revision, model=model, root=root
        )
        if inspection.state is RevisionState.CONFLICT:
            raise _conflict_error(revision, inspection)

        context = DwsRevisionContext(
            connection=connection,
            config=config,
            model=model,
            root=root,
            revision=revision,
        )
        if inspection.state is RevisionState.APPLIED:
            stamp_revision(connection, config, revision)
            connection.commit()
            result = RevisionResult(revision, "adopt", inspection.summary)
            results.append(result)
            if on_revision is not None:
                on_revision(result)
            continue

        try:
            adapter.apply(context)
        except DwsMigrationError:
            _safe_rollback(connection)
            raise
        except Exception as exc:
            _safe_rollback(connection)
            raise DwsMigrationError(
                revision,
                observed="revision apply raised an error",
                reason=str(exc),
                repairs=REPAIR_HINTS.get(revision, ()),
            ) from exc

        verified_model = _reflect(connection, config, root)
        verification = inspect_revision(
            connection, config, revision, model=verified_model, root=root
        )
        if verification.state is not RevisionState.APPLIED:
            _safe_rollback(connection)
            raise DwsMigrationError(
                revision,
                observed=verification.summary,
                reason=(
                    "the revision post-condition was not confirmed after apply; "
                    "the ledger was not advanced"
                ),
                details=verification.details,
                repairs=REPAIR_HINTS.get(revision, ()),
            )
        stamp_revision(connection, config, revision)
        connection.commit()
        result = RevisionResult(revision, "apply", verification.summary)
        results.append(result)
        if on_revision is not None:
            on_revision(result)
    return results
