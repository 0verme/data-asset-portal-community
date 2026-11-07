"""Database-backed, process-shared daily LLM request quota."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, literal_column, select, update

from ..contracts.ai_llm_quota import (
    AI_LLM_DAILY_LIMIT_CODE,
    AI_LLM_QUOTA_CATEGORY_CODE,
    AI_LLM_QUOTA_SCOPE,
    AI_LLM_QUOTA_TIMEZONE,
    DEFAULT_AI_LLM_DAILY_LIMIT,
    parse_daily_limit,
)
from ..db.facade import database_transaction
from ..db.service import CoreAccess
from ..db.tables import ai_llm_daily_usage, code_category, code_item

try:
    _BUSINESS_ZONE = ZoneInfo(AI_LLM_QUOTA_TIMEZONE)
except ZoneInfoNotFoundError:
    # Asia/Shanghai has used UTC+08:00 without daylight-saving transitions
    # since 1991. Keep current business-date accounting usable on platforms
    # (notably stock Windows Python) without an IANA timezone database.
    _BUSINESS_ZONE = timezone(timedelta(hours=8), name=AI_LLM_QUOTA_TIMEZONE)


class DailyLLMQuotaExceeded(Exception):
    """The shared daily allowance has been consumed."""


class DailyLLMQuotaUnavailable(Exception):
    """The quota store/config is unavailable or invalid; callers must fail closed."""


@dataclass(frozen=True)
class DailyLLMQuotaReservation:
    business_date: str


@dataclass(frozen=True)
class DailyLLMQuotaSnapshot:
    daily_limit: int
    used: int
    remaining: int
    business_date: str
    timezone: str = AI_LLM_QUOTA_TIMEZONE

    def as_dict(self) -> dict[str, int | str]:
        return {
            "parameterCode": AI_LLM_DAILY_LIMIT_CODE,
            "dailyLimit": self.daily_limit,
            "used": self.used,
            "remaining": self.remaining,
            "businessDate": self.business_date,
            "timezone": self.timezone,
        }


def current_business_date(now: datetime | None = None) -> date:
    value = now or datetime.now(UTC)
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(_BUSINESS_ZONE).date()


class DailyLLMQuotaService:
    """Reserve one global provider request atomically in the shared asset DB.

    The usage table intentionally keeps one row per scope with the active
    business date. On the first reservation after midnight its conditional
    UPDATE changes the date and resets the count; there is no timer or process
    local state. Older dates are not retained because the product exposes no
    historical reporting.
    """

    def __init__(
        self,
        *,
        profile_getter: Callable[[], str] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._profile_getter = profile_getter or (lambda: os.getenv("ASSET_DB_PROFILE", "").strip())
        self._clock = clock or (lambda: datetime.now(UTC))
        self._core = CoreAccess(
            profile_getter=self._profile_getter,
            error_factory=DailyLLMQuotaUnavailable,
        )

    def _today(self) -> str:
        return current_business_date(self._clock()).isoformat()

    def _read_daily_limit(self) -> int:
        rows = self._core.fetch_rows(
            select(
                code_item.c.item_value,
                code_item.c.is_active.label("item_active"),
                code_category.c.is_active.label("category_active"),
            )
            .select_from(code_item.outerjoin(
                code_category,
                code_category.c.category_code == code_item.c.category_code,
            ))
            .where(
                code_item.c.category_code == AI_LLM_QUOTA_CATEGORY_CODE,
                code_item.c.item_code == AI_LLM_DAILY_LIMIT_CODE,
            )
        )
        if not rows:
            # Safe for databases where the optional settings row is missing.
            return DEFAULT_AI_LLM_DAILY_LIMIT
        if len(rows) != 1:
            raise DailyLLMQuotaUnavailable("Daily LLM quota configuration is ambiguous")
        row = rows[0]
        if (
            str(row.get("item_active") or "").upper() != "N"
            or str(row.get("category_active") or "").upper() != "N"
        ):
            raise DailyLLMQuotaUnavailable("Daily LLM quota configuration is invalid")
        try:
            return parse_daily_limit(row.get("item_value"))
        except (TypeError, ValueError):
            raise DailyLLMQuotaUnavailable("Daily LLM quota configuration is invalid") from None

    def _read_usage(self) -> tuple[str, int]:
        rows = self._core.fetch_rows(
            select(
                ai_llm_daily_usage.c.business_date,
                ai_llm_daily_usage.c.used_count,
            ).where(ai_llm_daily_usage.c.scope_key == AI_LLM_QUOTA_SCOPE)
        )
        if len(rows) != 1:
            raise DailyLLMQuotaUnavailable("Daily LLM quota usage storage is unavailable")
        stored_date = str(rows[0].get("business_date") or "")
        try:
            parsed_date = date.fromisoformat(stored_date)
            raw_count = rows[0].get("used_count")
            used_count = int(raw_count)
        except (TypeError, ValueError):
            raise DailyLLMQuotaUnavailable("Daily LLM quota usage is invalid") from None
        if parsed_date.isoformat() != stored_date or used_count < 0 or str(raw_count).strip() != str(used_count):
            raise DailyLLMQuotaUnavailable("Daily LLM quota usage is invalid")
        return stored_date, used_count

    def get_daily_limit(self) -> int:
        try:
            return self._read_daily_limit()
        except DailyLLMQuotaUnavailable:
            raise
        except Exception:
            raise DailyLLMQuotaUnavailable("Daily LLM quota storage is unavailable") from None

    def snapshot(self) -> DailyLLMQuotaSnapshot:
        today = self._today()
        try:
            with database_transaction():
                daily_limit = self._read_daily_limit()
                stored_date, stored_count = self._read_usage()
                used = stored_count if stored_date == today else 0
                return DailyLLMQuotaSnapshot(
                    daily_limit=daily_limit,
                    used=used,
                    remaining=max(0, daily_limit - used),
                    business_date=today,
                )
        except DailyLLMQuotaUnavailable:
            raise
        except Exception:
            raise DailyLLMQuotaUnavailable("Daily LLM quota storage is unavailable") from None

    def reserve(self) -> DailyLLMQuotaReservation:
        """Atomically claim one slot before dispatching a provider request."""
        today = self._today()
        try:
            with database_transaction():
                # This no-op write serializes reservations with administrator
                # updates to the setting row. Unlike SELECT FOR UPDATE it also
                # obtains SQLite's write lock before the value is read.
                self._core.execute(
                    update(code_item)
                    .where(
                        code_item.c.category_code == AI_LLM_QUOTA_CATEGORY_CODE,
                        code_item.c.item_code == AI_LLM_DAILY_LIMIT_CODE,
                    )
                    .values(item_value=literal_column("item_value"))
                )
                daily_limit = self._read_daily_limit()
                stored_date, _stored_count = self._read_usage()
                self._core.execute(
                    update(ai_llm_daily_usage)
                    .where(
                        ai_llm_daily_usage.c.scope_key == AI_LLM_QUOTA_SCOPE,
                        ai_llm_daily_usage.c.business_date == stored_date,
                        ai_llm_daily_usage.c.business_date != today,
                    )
                    .values(
                        business_date=today,
                        used_count=0,
                        updated_at=func.current_timestamp(),
                    )
                )
                changed = self._core.execute(
                    update(ai_llm_daily_usage)
                    .where(
                        ai_llm_daily_usage.c.scope_key == AI_LLM_QUOTA_SCOPE,
                        ai_llm_daily_usage.c.business_date == today,
                        ai_llm_daily_usage.c.used_count < daily_limit,
                    )
                    .values(
                        used_count=ai_llm_daily_usage.c.used_count + 1,
                        updated_at=func.current_timestamp(),
                    )
                )
                if changed != 1:
                    current_date, current_count = self._read_usage()
                    if current_date == today and current_count >= daily_limit:
                        raise DailyLLMQuotaExceeded()
                    raise DailyLLMQuotaUnavailable("Daily LLM quota reservation failed")
                return DailyLLMQuotaReservation(business_date=today)
        except (DailyLLMQuotaExceeded, DailyLLMQuotaUnavailable):
            raise
        except Exception:
            raise DailyLLMQuotaUnavailable("Daily LLM quota storage is unavailable") from None

    def refund(self, reservation: DailyLLMQuotaReservation) -> bool:
        """Compensate only a reservation known not to have been dispatched.

        A midnight rollover makes an old reservation a no-op; it can never
        decrement the next business day's count. A failed refund leaves the
        conservative precharge in place rather than allowing an uncounted call.
        """
        try:
            with database_transaction():
                changed = self._core.execute(
                    update(ai_llm_daily_usage)
                    .where(
                        ai_llm_daily_usage.c.scope_key == AI_LLM_QUOTA_SCOPE,
                        ai_llm_daily_usage.c.business_date == reservation.business_date,
                        ai_llm_daily_usage.c.used_count > 0,
                    )
                    .values(
                        used_count=ai_llm_daily_usage.c.used_count - 1,
                        updated_at=func.current_timestamp(),
                    )
                )
                return changed == 1
        except Exception:
            raise DailyLLMQuotaUnavailable("Daily LLM quota refund failed") from None


daily_llm_quota_service = DailyLLMQuotaService()
