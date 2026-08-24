"""Deterministic login protection and FastAPI integration security tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi_app import create_fastapi_app
from backend.app.security.login_protection import (
    LoginAttemptLimiter,
    LoginProtectionPolicy,
)
from backend.app.services.auth_service import (
    AuthDataSourceError,
    AuthService,
    AuthValidationError,
    build_password_hash,
)


class ManualClock:
    def __init__(self, value: float = 1000.0):
        self.value = value

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class LoginAttemptLimiterTests(unittest.TestCase):
    def setUp(self):
        self.clock = ManualClock()
        self.policy = LoginProtectionPolicy(
            failure_window_seconds=60,
            failure_threshold=3,
            initial_backoff_seconds=2,
            max_backoff_seconds=8,
            state_ttl_seconds=20,
            max_entries=3,
        )
        self.limiter = LoginAttemptLimiter(policy=self.policy, clock=self.clock)

    def fail_once(self, username="alice", client="198.51.100.10"):
        self.assertTrue(self.limiter.check(username, client).allowed)
        return self.limiter.record_failure(username, client)

    def test_new_key_and_threshold_boundary(self):
        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)
        self.fail_once()
        self.fail_once()
        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)

        self.limiter.record_failure("alice", "198.51.100.10")
        decision = self.limiter.check("alice", "198.51.100.10")
        self.assertFalse(decision.allowed)
        self.assertEqual(2, decision.retry_after_seconds)

    def test_backoff_grows_and_is_capped(self):
        self.fail_once()
        self.fail_once()
        self.limiter.record_failure("alice", "198.51.100.10")
        self.assertEqual(
            2,
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
        )

        self.clock.advance(2)
        self.limiter.record_failure("alice", "198.51.100.10")
        self.assertEqual(
            4,
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
        )

        self.clock.advance(4)
        self.limiter.record_failure("alice", "198.51.100.10")
        self.assertEqual(
            8,
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
        )

        self.clock.advance(8)
        self.limiter.record_failure("alice", "198.51.100.10")
        self.assertEqual(
            8,
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
        )

    def test_retry_after_is_positive_until_backoff_expires(self):
        self.fail_once()
        self.fail_once()
        self.limiter.record_failure("alice", "198.51.100.10")
        blocked = self.limiter.check("alice", "198.51.100.10")
        self.assertGreater(blocked.retry_after_seconds, 0)

        self.clock.advance(1.5)
        self.assertGreater(
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
            0,
        )
        self.clock.advance(0.5)
        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)
        self.assertEqual(
            0,
            self.limiter.check("alice", "198.51.100.10").retry_after_seconds,
        )

    def test_window_expiration_drops_old_failures(self):
        self.fail_once()
        self.fail_once()
        self.clock.advance(self.policy.failure_window_seconds)

        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)
        self.limiter.record_failure("alice", "198.51.100.10")
        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)
        self.assertEqual(1, self.limiter.failure_count_for("alice", "198.51.100.10"))

    def test_success_clears_only_the_matching_pair(self):
        self.fail_once("alice", "198.51.100.10")
        self.fail_once("alice", "198.51.100.11")
        self.assertEqual(2, self.limiter.state_count)

        self.limiter.record_success("alice", "198.51.100.10")
        self.assertEqual(0, self.limiter.failure_count_for("alice", "198.51.100.10"))
        self.assertEqual(1, self.limiter.failure_count_for("alice", "198.51.100.11"))
        self.assertEqual(1, self.limiter.state_count)

    def test_ttl_cleanup_is_opportunistic(self):
        self.fail_once()
        self.assertEqual(1, self.limiter.state_count)
        self.clock.advance(self.policy.state_ttl_seconds)
        self.assertEqual(0, self.limiter.state_count)

    def test_capacity_evicts_oldest_entry(self):
        self.fail_once("alice", "198.51.100.10")
        self.fail_once("bob", "198.51.100.10")
        self.fail_once("carol", "198.51.100.10")
        self.fail_once("dave", "198.51.100.10")
        self.assertLessEqual(self.limiter.state_count, self.policy.max_entries)
        self.assertEqual(3, self.limiter.state_count)
        self.assertEqual(0, self.limiter.failure_count_for("alice", "198.51.100.10"))

    def test_key_isolation_and_stable_empty_fallbacks(self):
        self.fail_once("alice", "198.51.100.10")
        self.assertTrue(self.limiter.check("alice", "198.51.100.11").allowed)
        self.assertTrue(self.limiter.check("bob", "198.51.100.10").allowed)

        self.fail_once("", "")
        self.assertEqual(1, self.limiter.failure_count_for("  ", None))
        self.assertEqual(2, self.limiter.state_count)

    def test_username_key_preserves_case_sensitive_auth_semantics(self):
        self.fail_once("Alice", "198.51.100.10")
        self.assertTrue(self.limiter.check("alice", "198.51.100.10").allowed)

    def test_concurrent_failures_are_not_lost_and_capacity_stays_bounded(self):
        workers = 32
        policy = LoginProtectionPolicy(
            failure_window_seconds=60,
            failure_threshold=1000,
            initial_backoff_seconds=1,
            max_backoff_seconds=8,
            state_ttl_seconds=600,
            max_entries=workers + 1,
        )
        limiter = LoginAttemptLimiter(policy=policy, clock=self.clock)
        barrier = Barrier(workers)

        def record_one(index: int):
            barrier.wait()
            limiter.check("concurrent", "198.51.100.20")
            limiter.record_failure("concurrent", "198.51.100.20")
            limiter.record_failure(f"user-{index}", "198.51.100.20")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            list(executor.map(record_one, range(workers)))

        self.assertEqual(workers, limiter.failure_count_for("concurrent", "198.51.100.20"))
        self.assertLessEqual(limiter.state_count, policy.max_entries)

        bounded_policy = LoginProtectionPolicy(
            failure_window_seconds=60,
            failure_threshold=1000,
            initial_backoff_seconds=1,
            max_backoff_seconds=8,
            state_ttl_seconds=600,
            max_entries=2,
        )
        bounded_limiter = LoginAttemptLimiter(
            policy=bounded_policy,
            clock=self.clock,
        )
        bounded_barrier = Barrier(workers)

        def record_unique(index: int):
            bounded_barrier.wait()
            bounded_limiter.record_failure(f"bounded-{index}", "198.51.100.21")

        with ThreadPoolExecutor(max_workers=workers) as executor:
            list(executor.map(record_unique, range(workers)))
        self.assertLessEqual(bounded_limiter.state_count, bounded_policy.max_entries)


class AuthFailureSemanticsTests(unittest.TestCase):
    def test_unknown_user_and_wrong_password_share_external_contract(self):
        service = AuthService()
        active_user = {
            "status": "ACTIVE",
            "password_hash": build_password_hash("correct-password"),
            "display_name": "Alice",
            "role": "admin",
        }
        disabled_user = {**active_user, "status": "DISABLED"}
        with patch.object(
            service,
            "_fetch_user",
            side_effect=[None, active_user, disabled_user],
        ):
            with self.assertRaises(AuthValidationError) as unknown:
                service.authenticate("alice", "wrong-password")
            with self.assertRaises(AuthValidationError) as wrong_password:
                service.authenticate("alice", "wrong-password")
            with self.assertRaises(AuthValidationError) as disabled:
                service.authenticate("alice", "correct-password")

        external_contracts = [unknown.exception, wrong_password.exception, disabled.exception]
        self.assertEqual(
            {
                (error.status_code, error.code, error.message)
                for error in external_contracts
            },
            {(401, "INVALID_CREDENTIALS", "账号或密码不正确，请重试。")},
        )


class LoginProtectionFastApiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "login-protection-test-secret",
                "ASSET_TRUST_PROXY_HEADERS": "false",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities()
        self.user = {"role": "admin", "user": "alice", "name": "Alice"}

    def build_client(self, *, policy=None, auth_service=None):
        auth = auth_service or MagicMock(spec=AuthService)
        operation_logs = MagicMock()
        auth.authenticate.return_value = self.user
        clock = ManualClock()
        limiter = LoginAttemptLimiter(policy=policy, clock=clock)
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=get_native_session_identity,
            auth_service_instance=auth,
            operation_log_service_instance=operation_logs,
            login_protection_instance=limiter,
        )
        return TestClient(app), auth, limiter, clock

    @staticmethod
    def login(client, *, username="alice", password="wrong", headers=None):
        return client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers=headers,
        )

    def test_failed_login_is_limited_without_calling_auth_after_block(self):
        auth = MagicMock(spec=AuthService)
        auth.authenticate.side_effect = AuthValidationError(
            "账号或密码不正确，请重试。"
        )
        client, auth, limiter, _clock = self.build_client(auth_service=auth)

        for _ in range(limiter.policy.failure_threshold):
            self.assertEqual(401, self.login(client).status_code)
        auth.reset_mock()

        blocked = self.login(client)
        self.assertEqual(429, blocked.status_code)
        self.assertEqual("TOO_MANY_LOGIN_ATTEMPTS", blocked.json()["error"]["code"])
        self.assertGreater(int(blocked.headers["Retry-After"]), 0)
        auth.authenticate.assert_not_called()

    def test_success_clears_current_pair_and_preserves_session_logout_contract(self):
        policy = LoginProtectionPolicy(
            failure_window_seconds=60,
            failure_threshold=2,
            initial_backoff_seconds=2,
            max_backoff_seconds=8,
            state_ttl_seconds=600,
            max_entries=10,
        )
        auth = MagicMock(spec=AuthService)
        auth.authenticate.side_effect = [
            AuthValidationError("账号或密码不正确，请重试。"),
            self.user,
            AuthValidationError("账号或密码不正确，请重试。"),
            AuthValidationError("账号或密码不正确，请重试。"),
        ]
        client, auth, limiter, _clock = self.build_client(
            policy=policy,
            auth_service=auth,
        )

        self.assertEqual(401, self.login(client).status_code)
        success = self.login(client)
        self.assertEqual(200, success.status_code)
        self.assertIn("session=", success.headers["set-cookie"])
        self.assertEqual(401, self.login(client).status_code)
        self.assertEqual(401, self.login(client).status_code)
        self.assertEqual(4, auth.authenticate.call_count)
        self.assertEqual(2, limiter.failure_count_for("alice", "testclient"))

        current = client.get("/api/auth/me")
        self.assertEqual(200, current.status_code)
        logout = client.post("/api/auth/logout")
        self.assertEqual(200, logout.status_code)
        self.assertIn("session=", logout.headers["set-cookie"])
        self.assertEqual(401, client.get("/api/auth/me").status_code)

    def test_data_source_failure_does_not_consume_credential_failure_budget(self):
        policy = LoginProtectionPolicy(
            failure_window_seconds=60,
            failure_threshold=1,
            initial_backoff_seconds=2,
            max_backoff_seconds=8,
            state_ttl_seconds=600,
            max_entries=10,
        )
        auth = MagicMock(spec=AuthService)
        auth.authenticate.side_effect = [
            AuthDataSourceError("认证服务暂不可用，请稍后重试"),
            AuthValidationError("账号或密码不正确，请重试。"),
        ]
        client, auth, limiter, _clock = self.build_client(
            policy=policy,
            auth_service=auth,
        )

        self.assertEqual(500, self.login(client).status_code)
        self.assertEqual(0, limiter.failure_count_for("alice", "testclient"))
        self.assertEqual(401, self.login(client).status_code)
        self.assertEqual(1, limiter.failure_count_for("alice", "testclient"))
        self.assertEqual(2, auth.authenticate.call_count)

    def test_forged_xff_cannot_bypass_default_direct_peer_identity(self):
        auth = MagicMock(spec=AuthService)
        auth.authenticate.side_effect = AuthValidationError(
            "账号或密码不正确，请重试。"
        )
        client, auth, _limiter, _clock = self.build_client(auth_service=auth)

        for index in range(5):
            response = self.login(
                client,
                headers={"X-Forwarded-For": f"203.0.113.{index + 1}"},
            )
            self.assertEqual(401, response.status_code)
        bypass_attempt = self.login(
            client,
            headers={"X-Forwarded-For": "198.51.100.99"},
        )
        self.assertEqual(429, bypass_attempt.status_code)
        self.assertEqual(5, auth.authenticate.call_count)

    def test_trusted_proxy_address_is_the_limiter_identity_when_enabled(self):
        auth = MagicMock(spec=AuthService)
        auth.authenticate.side_effect = AuthValidationError(
            "账号或密码不正确，请重试。"
        )
        client, auth, _limiter, _clock = self.build_client(auth_service=auth)

        with patch.dict(os.environ, {"ASSET_TRUST_PROXY_HEADERS": "true"}):
            for _ in range(5):
                self.assertEqual(
                    401,
                    self.login(
                        client,
                        headers={"X-Forwarded-For": "203.0.113.10"},
                    ).status_code,
                )
            self.assertEqual(
                429,
                self.login(
                    client,
                    headers={"X-Forwarded-For": "203.0.113.10"},
                ).status_code,
            )
            different_trusted_client = self.login(
                client,
                headers={"X-Forwarded-For": "203.0.113.11"},
            )

        self.assertEqual(401, different_trusted_client.status_code)
        self.assertEqual(6, auth.authenticate.call_count)


if __name__ == "__main__":
    unittest.main()
