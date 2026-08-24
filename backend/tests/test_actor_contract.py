"""Focused contract tests for unified business audit actors."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest

from sqlalchemy.dialects import sqlite

from backend.app.application import (
    ActorSource,
    Identity,
    RequestContext,
    actor_aware,
    actor_scope,
    request_context_scope,
    resolve_actor,
)
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.operation_log_service import OperationLogService
from fastapi.testclient import TestClient


class ActorResolutionTests(unittest.TestCase):
    def test_authenticated_request_identity_wins(self):
        with request_context_scope(
            RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        ):
            actor = resolve_actor()

        self.assertEqual("alice", actor.id)
        self.assertEqual("alice", actor.name)
        self.assertEqual("Alice", actor.operation_name)
        self.assertEqual(ActorSource.REQUEST, actor.source)

    def test_authenticated_request_identity_cannot_be_overridden(self):
        with request_context_scope(
            RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        ):
            actor = resolve_actor(explicit_actor="bob", system_actor="system")

        self.assertEqual("alice", actor.name)
        self.assertEqual(ActorSource.REQUEST, actor.source)

    def test_explicit_non_request_actor(self):
        actor = resolve_actor(explicit_actor="metadata-importer")

        self.assertEqual("metadata-importer", actor.name)
        self.assertEqual(ActorSource.EXPLICIT, actor.source)

    def test_explicit_background_system_actor(self):
        actor = resolve_actor(system_actor="system")

        self.assertEqual("system", actor.name)
        self.assertEqual(ActorSource.SYSTEM, actor.source)

    def test_missing_actor_is_anonymous_not_system(self):
        actor = resolve_actor()

        self.assertEqual("anonymous", actor.name)
        self.assertEqual(ActorSource.ANONYMOUS, actor.source)
        self.assertNotEqual("system", actor.name)

    def test_actor_and_request_context_scopes_are_isolated(self):
        with request_context_scope(
            RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        ):
            self.assertEqual("alice", resolve_actor().name)
            with actor_scope(resolve_actor(explicit_actor="bob")):
                # The request identity remains authoritative even inside an
                # explicit operation scope.
                self.assertEqual("alice", resolve_actor().name)
            self.assertEqual("alice", resolve_actor().name)

        self.assertEqual(ActorSource.ANONYMOUS, resolve_actor().source)
        with actor_scope(resolve_actor(system_actor="system")):
            self.assertEqual("system", resolve_actor().name)
        self.assertEqual(ActorSource.ANONYMOUS, resolve_actor().source)

    def test_actor_aware_service_boundary_accepts_explicit_actor(self):
        @actor_aware
        def operation():
            return resolve_actor()

        self.assertEqual("metadata-importer", operation(actor="metadata-importer").name)
        with request_context_scope(
            RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        ):
            self.assertEqual("alice", operation(actor="metadata-importer").name)

    def test_fastapi_http_context_resolves_and_cleans_up_the_request_actor(self):
        app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: Identity("maintainer", "alice", "Alice"),
        )

        @app.post("/_actor-contract-probe")
        def probe():
            @actor_aware
            def mutation():
                actor = resolve_actor()
                return {"name": actor.name, "source": actor.source.value}

            return mutation(actor="forged-client")

        response = TestClient(app).post("/_actor-contract-probe")

        self.assertEqual(200, response.status_code)
        self.assertEqual({"name": "alice", "source": "request"}, response.json())
        self.assertEqual(ActorSource.ANONYMOUS, resolve_actor().source)


class OperationLogActorAlignmentTests(unittest.TestCase):
    def test_operation_log_uses_same_request_actor_and_preserves_display_name(self):
        service = OperationLogService()
        with request_context_scope(
            RequestContext(
                identity=Identity("maintainer", "alice", "Alice"),
                method="POST",
                path="/api/assets/tables",
            )
        ):
            context = service._request_context()
            overridden = service._request_context(actor="bob")

        self.assertEqual("alice", context["userId"])
        self.assertEqual("Alice", context["userName"])
        self.assertEqual(context, overridden)

    def test_operation_log_accepts_explicit_non_request_actor(self):
        service = OperationLogService()
        context = service._request_context(actor="metadata-importer")

        self.assertEqual("", context["userId"])
        self.assertEqual("metadata-importer", context["userName"])

    def test_authenticated_operation_log_ignores_legacy_identity_overrides(self):
        service = OperationLogService()
        with request_context_scope(
            RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        ):
            statement = service._build_audit_insert_statement(
                module_name="assets",
                operation_type="UPDATE",
                operation_object="orders",
                user_id="bob",
                user_name="Bob",
            )

        params = statement.compile(dialect=sqlite.dialect()).params
        self.assertEqual("alice", params["user_id"])
        self.assertEqual("Alice", params["user_name"])
        self.assertNotIn("bob", params.values())
        self.assertNotIn("Bob", params.values())

    def test_explicit_actor_is_not_replaced_by_legacy_identity_overrides(self):
        service = OperationLogService()
        statement = service._build_audit_insert_statement(
            module_name="metadata",
            operation_type="IMPORT",
            operation_object="batch-1",
            actor="metadata-importer",
            user_id="bob",
            user_name="Bob",
        )

        params = statement.compile(dialect=sqlite.dialect()).params
        self.assertEqual("", params["user_id"])
        self.assertEqual("metadata-importer", params["user_name"])
        self.assertNotIn("bob", params.values())
        self.assertNotIn("Bob", params.values())


if __name__ == "__main__":
    unittest.main()
