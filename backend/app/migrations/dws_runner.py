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
    BASELINE_REVISION,
    SCHEMA_ROOT,
    SchemaModel,
    baseline_schema,
    current_revision,
    reflect_schema,
    stamp_revision,
    verify_schema,
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


def _safe_rollback(connection) -> Exception | None:
    try:
        connection.rollback()
        return None
    except Exception as exc:
        return exc


def _record_verified_revision(
    connection,
    config: dict,
    revision: str,
    previous_revision: str | None,
) -> None:
    """Atomically stamp a verified revision, preserving the prior ledger on failure."""
    try:
        stamp_revision(connection, config, revision)
        connection.commit()
        return
    except Exception as exc:
        rollback_error = _safe_rollback(connection)
        try:
            recorded = current_revision(connection, config)
            ledger_observation = repr(recorded)
        except Exception as read_error:
            recorded = None
            ledger_observation = f"unreadable ({read_error})"

        # A lost commit acknowledgement can leave the new value durable. It is
        # safe to continue only after rollback and a fresh read confirm it.
        if rollback_error is None and recorded == revision:
            return
        prior_is_intact = recorded == previous_revision
        prior_state_message = (
            "The ledger remains uninitialized."
            if previous_revision is None
            else "The previous ledger value is intact."
        )
        repairs = (
            "do not edit the ledger manually; after the connection is healthy, rerun "
            "apply so the runner re-inspects the physical post-condition before "
            "adopting or applying this revision",
            "an empty DWS ledger is recoverable only when the complete canonical "
            "baseline verifies; partial schemas and multi-row/unknown ledgers remain blocked",
        )
        raise DwsMigrationError(
            revision,
            observed=(
                "physical post-condition was confirmed, but the revision ledger "
                f"is {ledger_observation}"
            ),
            reason=(
                "ledger write/commit failed; execution stops before the next revision. "
                + (
                    prior_state_message
                    if prior_is_intact
                    else "The ledger is not confirmed at either the previous or target revision."
                )
            ),
            details=(
                f"expected previous revision: {previous_revision!r}",
                f"target revision: {revision!r}",
                f"ledger write error: {exc}",
                *(
                    (f"rollback error: {rollback_error}",)
                    if rollback_error is not None
                    else ()
                ),
            ),
            repairs=repairs,
        ) from exc


def _verify_revision_postconditions(
    connection, config: dict, head: str, root: Path
) -> None:
    model = _reflect(connection, config, root)
    for revision in revision_chain(BASELINE_REVISION, head):
        inspection = inspect_revision(
            connection, config, revision, model=model, root=root
        )
        if inspection.state is not RevisionState.APPLIED:
            raise DwsMigrationError(
                revision,
                observed=inspection.summary,
                reason=(
                    "DWS head verification requires every registered revision "
                    "post-condition to be physically present"
                ),
                details=inspection.details,
                repairs=REPAIR_HINTS.get(revision, ()),
            )


def verify_repository_head(
    connection,
    config: dict,
    head: str,
    *,
    root: Path = SCHEMA_ROOT,
) -> str:
    """Verify the DWS ledger, full baseline and every revision post-condition."""
    recorded = current_revision(connection, config)
    if recorded != head:
        raise DwsMigrationError(
            recorded or "unmanaged",
            observed=f"ledger revision is {recorded!r}; repository head is {head!r}",
            reason=(
                f"DWS ledger is behind repository head {head!r}"
                if recorded is not None and recorded != head
                else "DWS verify requires a stamped repository head"
            ),
        )
    verify_schema(connection, config, "dws", root)
    _verify_revision_postconditions(connection, config, head, root)
    return head


def _verify_repository_head_schema(
    connection,
    config: dict,
    revision: str,
    head: str,
    root: Path,
) -> None:
    if revision != head or head != repository_head():
        return
    try:
        verify_schema(connection, config, "dws", root)
        _verify_revision_postconditions(connection, config, head, root)
    except DwsMigrationError as exc:
        rollback_error = _safe_rollback(connection)
        if rollback_error is None:
            raise
        raise DwsMigrationError(
            exc.revision,
            observed=exc.observed,
            reason=(exc.reason + "; connection rollback also failed, so physical state is uncertain"),
            details=(*exc.details, f"rollback error: {rollback_error}"),
            repairs=exc.repairs,
        ) from exc
    except Exception as exc:
        rollback_error = _safe_rollback(connection)
        raise DwsMigrationError(
            revision,
            observed="per-revision postcondition passed, but full head schema verification failed",
            reason=(
                "the repository head cannot be stamped while the complete canonical "
                "DWS schema differs"
                if rollback_error is None
                else "the repository head cannot be stamped; full schema verification and "
                "connection rollback both failed, so physical state is uncertain"
            ),
            details=(
                str(exc),
                *(
                    (f"rollback error: {rollback_error}",)
                    if rollback_error is not None
                    else ()
                ),
            ),
            repairs=(
                "inspect the schema mismatch and repair only the explicitly identified "
                "objects; rerun apply after the full physical schema is understood",
            ),
        ) from exc


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
    # Validate the complete requested path before the first ledger write. In
    # particular, an unknown start must never be stamped into an empty ledger.
    chain = revision_chain(start, head)
    ledger = current_revision(connection, config)
    if ledger is None:
        _record_verified_revision(connection, config, start, None)
        ledger = start
    elif ledger != start:
        raise DwsMigrationError(
            start,
            observed=f"ledger revision changed during migration: {ledger!r}",
            reason="the runner refuses to operate on a different ledger revision",
        )

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
            _verify_repository_head_schema(connection, config, revision, head, root)
            _record_verified_revision(connection, config, revision, ledger)
            ledger = revision
            result = RevisionResult(revision, "adopt", inspection.summary)
            results.append(result)
            if on_revision is not None:
                on_revision(result)
            continue

        try:
            adapter.apply(context)
        except DwsMigrationError as exc:
            rollback_error = _safe_rollback(connection)
            if rollback_error is None:
                raise
            raise DwsMigrationError(
                revision,
                observed=exc.observed,
                reason=(exc.reason + "; connection rollback also failed, so the physical state is uncertain"),
                details=(*exc.details, f"rollback error: {rollback_error}"),
                repairs=exc.repairs or REPAIR_HINTS.get(revision, ()),
            ) from exc
        except Exception as exc:
            rollback_error = _safe_rollback(connection)
            details = (
                (f"rollback error: {rollback_error}",)
                if rollback_error is not None
                else ()
            )
            raise DwsMigrationError(
                revision,
                observed="revision apply raised an error",
                reason=(
                    str(exc)
                    if rollback_error is None
                    else f"{exc}; connection rollback also failed, physical state is uncertain"
                ),
                details=details,
                repairs=REPAIR_HINTS.get(revision, ()),
            ) from exc

        verified_model = _reflect(connection, config, root)
        verification = inspect_revision(
            connection, config, revision, model=verified_model, root=root
        )
        if verification.state is not RevisionState.APPLIED:
            rollback_error = _safe_rollback(connection)
            rollback_detail = (
                (f"rollback error: {rollback_error}",)
                if rollback_error is not None
                else ()
            )
            raise DwsMigrationError(
                revision,
                observed=verification.summary,
                reason=(
                    "the revision post-condition was not confirmed after apply; "
                    "the ledger was not advanced"
                    if rollback_error is None
                    else "the revision post-condition was not confirmed, the ledger was not "
                    "advanced, and connection rollback failed so physical state is uncertain"
                ),
                details=(*verification.details, *rollback_detail),
                repairs=REPAIR_HINTS.get(revision, ()),
            )
        _verify_repository_head_schema(connection, config, revision, head, root)
        _record_verified_revision(connection, config, revision, ledger)
        ledger = revision
        result = RevisionResult(revision, "apply", verification.summary)
        results.append(result)
        if on_revision is not None:
            on_revision(result)
    return results
