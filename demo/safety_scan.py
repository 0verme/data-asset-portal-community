#!/usr/bin/env python3
"""Repository Public Data Guard — shared sensitive-data scanning primitives.

Used by:
  - demo/validate_demo_data.py  (whole-repo public data guard)
  - scripts/sync_from_pg.py     (pre-commit scan before repository output)
  - backend/scripts/db_to_init_sql.py (same)

Findings are classified as SAFE / EXPECTED / SUSPICIOUS / BLOCKER so that a
keyword hit (e.g. ``password: change_me``) is not treated as a leak.

This module contains no private data itself — only generic detection patterns.
"""

from __future__ import annotations

import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Detection patterns
# ---------------------------------------------------------------------------
PRIVATE_IPV4 = re.compile(
    r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b"
)
DOCUMENTATION_IPV4 = re.compile(r"\b(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}\b")
INTERNAL_DOMAIN = re.compile(
    r"\b(?:[\w-]+\.)+(?:" + "|".join(map(re.escape, ("intra", "internal", "corp", "lan"))) + r")(?::[0-9]+)?\b",
    re.IGNORECASE,
)
EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
WINDOWS_PATH = re.compile(r"\b[A-Za-z]:\\(?:Users|Windows|Program)", re.IGNORECASE)
USER_HOME_PATH = re.compile(r"(?:^|[\s\"'])(?:/home|/Users)/[^/\"'\s]+")
INTERNAL_SVN_PATH = re.compile(
    r"(?:" + "|".join(map(re.escape, ("svn", "DIDP_PROJECT", "hcyttrunk"))) + ")",
    re.IGNORECASE,
)
CONNECTION_STRING = re.compile(
    r"(?:postgres(?:ql)?|mysql|oracle|mongodb|jdbc:[a-z]+|sftp|ftp)://[^\s\"']+",
    re.IGNORECASE,
)
JDBC_URL = re.compile(r"jdbc:gaussdb://[^\s\"']+", re.IGNORECASE)

# Secret keywords. A hit alone is NOT a finding: the value is inspected to
# decide EXPECTED (placeholder / env-var name / masked) vs SUSPICIOUS.
SECRET_KEYWORDS = re.compile(
    r"\b(?:password|passwd|pwd|token|secret|api[_-]?key|private[_-]?key"
    r"|authorization|bearer|credential)\b",
    re.IGNORECASE,
)
# Values that look like placeholders or documentation, not real secrets.
PLACEHOLDER_VALUE = re.compile(
    r"(?:change_me|your[_-]?|example|sample|placeholder|<[^>]+>|xxx+|\\*\\*\\*+|...|"
    r"store-in-secret-manager|\\$\{[A-Z_]+\}|%[A-Z_]+%)",
    re.IGNORECASE,
)
# Real-looking secret values (assigned inline, not env var name).
REAL_SECRET_VALUE = re.compile(
    r"(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s\"'<]+",
    re.IGNORECASE,
)

# Business-sensitive vocabulary of the original internal product. Kept narrow:
# only confirmed residue markers from the pre-public tree.
BUSINESS_TERMS = tuple(
    _w for _w in ("核心银行", "反洗钱", "信贷管理", "支付清算", "账务系统", "贷款", "存款", "借据")
)
# Words that are fine to discuss (e.g. "bank" as a generic example) — used by
# scanners to skip an otherwise-forbidden term inside an allowlisted context.
ALLOWLIST_TERMS = ("示例", "example", "demo", "mock", "虚构", "placeholder", "模板")

# Paths covered by the whole-repo guard (relative to repo root).
GUARD_DIRS = (
    "demo/",
    "frontend/src/data/",
    "frontend/packages/",
    "docs/",
    "backend/configs/",
    "backend/scripts/",
    "scripts/",
    "backend/tests/",
)
GUARD_FILES = (
    "README.md",
    "DEPLOYMENT.md",
    "DEVELOPMENT.md",
    "CONTRIBUTING.md",
    "NOTICE",
    "backend/.env.example",
    "frontend/.env.example",
)


def classify(text: str, label: str) -> list[dict]:
    """Scan text and return classified findings.

    Returns a list of dicts: {"label", "category", "severity", "detail"}.
    severity is one of SAFE / EXPECTED / SUSPICIOUS / BLOCKER.
    """
    findings: list[dict] = []

    for _match in PRIVATE_IPV4.finditer(text):
        findings.append(
            {
                "label": label,
                "category": "network",
                "severity": "BLOCKER",
                "detail": "private IPv4 address (RFC1918)",
            }
        )
    for _match in DOCUMENTATION_IPV4.finditer(text):
        findings.append(
            {
                "label": label,
                "category": "network",
                "severity": "SAFE",
                "detail": "documentation IP (RFC 5737 TEST-NET)",
            }
        )
    for match in INTERNAL_DOMAIN.finditer(text):
        domain = match.group(0).lower()
        if domain in ("local", ".local"):
            continue
        window = text[max(0, match.start() - 30) : match.end() + 40]
        if "internal server error" in window.lower():
            # HTTP status phrase (e.g. `500 Internal Server Error`), not a domain.
            findings.append(
                {"label": label, "category": "network", "severity": "SAFE", "detail": "HTTP status phrase"}
            )
            continue
        if "example." in domain:
            # RFC 2606-style placeholder domain (e.g. `registry.example.internal`
            # in vendored third-party docs) is documentation, not a real host.
            findings.append(
                {"label": label, "category": "network", "severity": "SAFE", "detail": "example placeholder domain"}
            )
            continue
        findings.append(
            {
                "label": label,
                "category": "network",
                "severity": "SUSPICIOUS",
                "detail": f"internal domain suffix: {domain}",
            }
        )
    for match in EMAIL.finditer(text):
        if match.group(0).lower().endswith("@demo.invalid"):
            findings.append(
                {"label": label, "category": "network", "severity": "SAFE", "detail": "demo email"}
            )
        else:
            findings.append(
                {
                    "label": label,
                    "category": "network",
                    "severity": "SUSPICIOUS",
                    "detail": "non-demo email address",
                }
            )
    for _match in PHONE.finditer(text):
        findings.append(
            {"label": label, "category": "network", "severity": "SUSPICIOUS", "detail": "phone number"}
        )
    for _match in WINDOWS_PATH.finditer(text):
        findings.append(
            {"label": label, "category": "path", "severity": "BLOCKER", "detail": "Windows user path"}
        )
    for _match in USER_HOME_PATH.finditer(text):
        findings.append(
            {"label": label, "category": "path", "severity": "SUSPICIOUS", "detail": "user home path"}
        )
    for match in INTERNAL_SVN_PATH.finditer(text):
        findings.append(
            {
                "label": label,
                "category": "path",
                "severity": "SUSPICIOUS",
                "detail": f"internal workspace marker: {match.group(0)}",
            }
        )
    for match in CONNECTION_STRING.finditer(text):
        window = text[max(0, match.start() - 40) : match.end() + 60]
        if (
            "demo" in match.group(0).lower()
            or "127.0.0.1" in match.group(0)
            or "example" in match.group(0).lower()
            or "示例" in window
            or "SYNC_PG_DSN" in window
        ):
            findings.append(
                {"label": label, "category": "secret", "severity": "EXPECTED", "detail": "example connection string"}
            )
        else:
            findings.append(
                {
                    "label": label,
                    "category": "secret",
                    "severity": "SUSPICIOUS",
                    "detail": "connection string",
                }
            )
    for match in JDBC_URL.finditer(text):
        window = text[max(0, match.start() - 40) : match.end() + 60]
        if "example" in match.group(0).lower() or "demo" in match.group(0).lower() or "127.0.0.1" in match.group(0) or "示例" in window:
            findings.append(
                {"label": label, "category": "secret", "severity": "EXPECTED", "detail": "example JDBC URL"}
            )
        else:
            findings.append(
                {"label": label, "category": "secret", "severity": "SUSPICIOUS", "detail": "JDBC URL"}
            )

    for match in SECRET_KEYWORDS.finditer(text):
        window = text[max(0, match.start() - 40) : match.end() + 80]
        if PLACEHOLDER_VALUE.search(window):
            findings.append(
                {
                    "label": label,
                    "category": "secret",
                    "severity": "EXPECTED",
                    "detail": f"placeholder secret: {match.group(0)}",
                }
            )
        elif REAL_SECRET_VALUE.search(window) and not _is_env_var_name(window):
            findings.append(
                {
                    "label": label,
                    "category": "secret",
                    "severity": "SUSPICIOUS",
                    "detail": f"possible inline secret: {match.group(0)}",
                }
            )
        else:
            findings.append(
                {
                    "label": label,
                    "category": "secret",
                    "severity": "EXPECTED",
                    "detail": f"secret keyword (env var / config): {match.group(0)}",
                }
            )

    for term in BUSINESS_TERMS:
        if term.lower() in text.lower():
            line_context = _line_containing(text, term)
            if any(word in line_context for word in ALLOWLIST_TERMS):
                findings.append(
                    {
                        "label": label,
                        "category": "business",
                        "severity": "SAFE",
                        "detail": f"allowlisted mention of {term}",
                    }
                )
            elif _is_naming_reference_row(line_context):
                # seed corpus rows like `loan|loan|贷款|业务对象|用于 loan_no` are
                # generic naming-reference samples, not real business records.
                findings.append(
                    {
                        "label": label,
                        "category": "business",
                        "severity": "SAFE",
                        "detail": f"generic naming-reference row mentioning {term}",
                    }
                )
            else:
                findings.append(
                    {
                        "label": label,
                        "category": "business",
                        "severity": "SUSPICIOUS",
                        "detail": f"business-sensitive term: {term}",
                    }
                )
    return findings


def _is_naming_reference_row(line: str) -> bool:
    """True for seed-corpus rows like `abbr|en|cn|category|desc` (5 pipe-separated columns)."""
    return len(line.split("|")) >= 4 and re.match(r"^\s*[a-z0-9_]+\|\s*[a-zA-Z ]+\|", line) is not None


def _line_containing(text: str, term: str) -> str:
    for line in text.splitlines():
        if term.lower() in line.lower():
            return line
    return ""


def _is_env_var_name(window: str) -> bool:
    return bool(re.search(r"\b[A-Z][A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)\b", window))


def scan_file(path: Path, repo_root: Path) -> list[dict]:
    """Scan one file (text). Returns classified findings."""
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except UnicodeDecodeError:
        return []
    label = path.relative_to(repo_root).as_posix()
    return classify(text, label)


def high_severity(findings: list[dict], severities=("BLOCKER", "SUSPICIOUS")) -> list[dict]:
    return [f for f in findings if f.get("severity") in severities]
