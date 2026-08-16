from __future__ import annotations

import logging
import time

from ..settings import get_float_env




def log_slow_service_call(
    logger: logging.Logger,
    *,
    service: str,
    method: str,
    purpose: str,
    started_at: float,
    page=None,
    page_size=None,
    keyword=None,
):
    elapsed = time.perf_counter() - started_at
    if elapsed < get_float_env("APP_SLOW_SERVICE_SECONDS", 3.0, minimum=0.0):
        return elapsed

    logger.warning(
        "slow service call service=%s method=%s purpose=%s elapsed_ms=%s page=%s page_size=%s keyword_empty=%s",
        service,
        method,
        purpose,
        round(elapsed * 1000, 2),
        page,
        page_size,
        not bool(str(keyword or "").strip()),
    )
    return elapsed
