"""Bounded, process-local protection for online login attempts.

The core deliberately knows nothing about FastAPI or any other HTTP runtime.
Applications provide the normalized username and the client identity already
resolved at their trusted request boundary.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock
from typing import Callable

EMPTY_USERNAME_KEY = "<empty-username>"
UNKNOWN_CLIENT_IDENTITY_KEY = "<unknown-client>"
_MAX_USERNAME_KEY_LENGTH = 256
_MAX_CLIENT_IDENTITY_KEY_LENGTH = 128


@dataclass(frozen=True, slots=True)
class LoginProtectionPolicy:
    """Safe default policy for a single-process Community deployment.

    The defaults allow a small number of ordinary mistakes, then apply 2/4/8
    second backoff steps (capped at 30 seconds) without sleeping a worker.
    TTL and capacity keep this local replacement bounded without infrastructure.
    """

    failure_window_seconds: float = 60.0
    failure_threshold: int = 5
    initial_backoff_seconds: float = 2.0
    max_backoff_seconds: float = 30.0
    state_ttl_seconds: float = 15 * 60.0
    max_entries: int = 10_000

    def __post_init__(self) -> None:
        if self.failure_window_seconds <= 0 or not math.isfinite(
            self.failure_window_seconds
        ):
            raise ValueError("failure_window_seconds must be positive and finite")
        if self.failure_threshold < 1:
            raise ValueError("failure_threshold must be positive")
        if self.initial_backoff_seconds <= 0 or not math.isfinite(
            self.initial_backoff_seconds
        ):
            raise ValueError("initial_backoff_seconds must be positive and finite")
        if self.max_backoff_seconds < self.initial_backoff_seconds or not math.isfinite(
            self.max_backoff_seconds
        ):
            raise ValueError(
                "max_backoff_seconds must be finite and at least the initial backoff"
            )
        if self.state_ttl_seconds <= 0 or not math.isfinite(self.state_ttl_seconds):
            raise ValueError("state_ttl_seconds must be positive and finite")
        if self.max_entries < 1:
            raise ValueError("max_entries must be positive")


@dataclass(frozen=True, slots=True)
class LoginProtectionDecision:
    """Result of checking whether an attempt may reach authentication."""

    allowed: bool
    retry_after_seconds: int = 0


@dataclass(slots=True)
class _FailureState:
    window_started_at: float
    last_activity_at: float
    failure_count: int = 0
    blocked_until: float = 0.0


def _bounded_key_text(value: object, fallback: str, maximum: int) -> str:
    """Keep each state key component bounded without changing normal values."""
    try:
        text = "" if value is None else str(value).strip()
    except Exception:
        text = ""
    if not text:
        return fallback
    if len(text) <= maximum:
        return text
    digest = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
    return f"<sha256:{digest}>"


def normalize_login_username(username: object) -> str:
    """Match AuthService's strip-only semantics; do not case-fold usernames."""
    return _bounded_key_text(
        username,
        EMPTY_USERNAME_KEY,
        _MAX_USERNAME_KEY_LENGTH,
    )


def normalize_client_identity(client_identity: object) -> str:
    """Use a stable fallback when request context has no client address."""
    return _bounded_key_text(
        client_identity,
        UNKNOWN_CLIENT_IDENTITY_KEY,
        _MAX_CLIENT_IDENTITY_KEY_LENGTH,
    )


class LoginAttemptLimiter:
    """Thread-safe, bounded login failure window with temporary backoff.

    State is intentionally process-local.  It is suitable for the Community
    single-node deployment and can later be replaced behind this small API if a
    deployment needs shared state.
    """

    def __init__(
        self,
        *,
        policy: LoginProtectionPolicy | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.policy = policy or LoginProtectionPolicy()
        self._clock = clock
        self._states: OrderedDict[tuple[str, str], _FailureState] = OrderedDict()
        self._lock = RLock()

    def _now(self) -> float:
        value = float(self._clock())
        if not math.isfinite(value):
            raise ValueError("login protection clock must return a finite value")
        return value

    @staticmethod
    def _key(username: object, client_identity: object) -> tuple[str, str]:
        return normalize_login_username(username), normalize_client_identity(
            client_identity
        )

    def _cleanup_expired_locked(self, now: float) -> None:
        expired = [
            key
            for key, state in self._states.items()
            if state.blocked_until <= now
            and now - state.last_activity_at >= self.policy.state_ttl_seconds
        ]
        for key in expired:
            self._states.pop(key, None)

    def _evict_for_new_entry_locked(self) -> None:
        while len(self._states) >= self.policy.max_entries:
            self._states.popitem(last=False)

    def _reset_window_if_expired_locked(
        self,
        key: tuple[str, str],
        state: _FailureState,
        now: float,
    ) -> _FailureState | None:
        if (
            state.blocked_until <= now
            and now - state.window_started_at >= self.policy.failure_window_seconds
        ):
            self._states.pop(key, None)
            return None
        return state

    @staticmethod
    def _allowed() -> LoginProtectionDecision:
        return LoginProtectionDecision(allowed=True)

    @staticmethod
    def _decision_for_state(
        state: _FailureState, now: float
    ) -> LoginProtectionDecision:
        remaining = state.blocked_until - now
        if remaining <= 0:
            return LoginProtectionDecision(allowed=True)
        return LoginProtectionDecision(
            allowed=False,
            retry_after_seconds=max(1, int(math.ceil(remaining))),
        )

    def check(self, username: object, client_identity: object) -> LoginProtectionDecision:
        """Return whether an attempt may proceed without blocking the worker."""
        key = self._key(username, client_identity)
        now = self._now()
        with self._lock:
            self._cleanup_expired_locked(now)
            state = self._states.get(key)
            if state is None:
                return self._allowed()
            state = self._reset_window_if_expired_locked(key, state, now)
            if state is None:
                return self._allowed()
            self._states.move_to_end(key)
            return self._decision_for_state(state, now)

    def record_failure(
        self, username: object, client_identity: object
    ) -> LoginProtectionDecision:
        """Record one credential-validation failure and apply backoff if due."""
        key = self._key(username, client_identity)
        now = self._now()
        with self._lock:
            self._cleanup_expired_locked(now)
            state = self._states.get(key)
            if state is not None:
                state = self._reset_window_if_expired_locked(key, state, now)
            if state is None:
                self._evict_for_new_entry_locked()
                state = _FailureState(
                    window_started_at=now,
                    last_activity_at=now,
                )
                self._states[key] = state
            else:
                self._states.move_to_end(key)

            state.failure_count += 1
            state.last_activity_at = now
            if state.failure_count >= self.policy.failure_threshold:
                backoff = self.policy.initial_backoff_seconds
                for _ in range(
                    state.failure_count - self.policy.failure_threshold
                ):
                    if backoff >= self.policy.max_backoff_seconds:
                        break
                    backoff = min(
                        self.policy.max_backoff_seconds,
                        backoff * 2,
                    )
                state.blocked_until = now + backoff
            else:
                state.blocked_until = 0.0
            return self._decision_for_state(state, now)

    def record_success(self, username: object, client_identity: object) -> None:
        """Clear only the successful username/client identity pair."""
        key = self._key(username, client_identity)
        now = self._now()
        with self._lock:
            self._cleanup_expired_locked(now)
            self._states.pop(key, None)

    @property
    def state_count(self) -> int:
        """Return the live entry count after opportunistic TTL cleanup."""
        now = self._now()
        with self._lock:
            self._cleanup_expired_locked(now)
            return len(self._states)

    def failure_count_for(self, username: object, client_identity: object) -> int:
        """Expose a deterministic count for diagnostics and focused tests."""
        key = self._key(username, client_identity)
        now = self._now()
        with self._lock:
            self._cleanup_expired_locked(now)
            state = self._states.get(key)
            if state is None:
                return 0
            state = self._reset_window_if_expired_locked(key, state, now)
            return state.failure_count if state is not None else 0

    def __len__(self) -> int:
        return self.state_count
