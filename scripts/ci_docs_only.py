#!/usr/bin/env python3
"""Read-only PR change classification, docs-only guard checks, and CI gate evaluation.

Implements Issue #625 (P0 — Pure Markdown documentation PR fast path):
  1. Fail-closed (`docs_only=false`) change classification for pull_request events.
  2. Strict path, git mode, rename/copy/delete/add, binary, shebang, and UTF-8 checks.
  3. Lightweight docs-only validation (diff check, relative link/path validation,
     Public Data Guard scanning on all changed Markdown files, and doc contract tests).
  4. Required Check aggregator gate (`Frontend / Node 22`) evaluation that preserves
     strict failure on real errors/cancellations/skips in full CI while allowing the
     verified docs-only fast path to complete cleanly.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest
from urllib.parse import unquote

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(REPO_ROOT / "demo") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "demo"))

SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
REGULAR_FILE_MODES = frozenset({"100644", "000000"})

# Directories that must NEVER be classified as docs-only even if a `.md` file
# is placed inside them.
FORBIDDEN_PATH_PREFIXES = (
    ".github/",
    "scripts/",
    "backend/scripts/",
    "frontend/scripts/",
    "backend/tests/",
    "frontend/tests/",
    "frontend/e2e/",
    "backend/alembic/versions/",
    "backend/migrations/",
    "backend/configs/",
    "demo/datasets/",
)

FORBIDDEN_DIR_SEGMENTS = frozenset(
    {
        ".github",
        "workflows",
        "scripts",
        "tests",
        "test",
        "__tests__",
        "e2e",
        "fixtures",
        "configs",
        "versions",
        "migrations",
        "node_modules",
        "dist",
        "build",
        ".venv",
    }
)

# Explicit allowlist of Markdown documentation path patterns (POSIX relative paths).
ALLOWED_DOC_PATH_PATTERNS = (
    # Root-level repository Markdown documents (e.g. README.md, CONTRIBUTING.md)
    re.compile(r"^[A-Za-z0-9_.-]+\.md$"),
    # Documentation tree (e.g. docs/architecture.md, docs/adr/*.md, docs/rbac/*.md)
    re.compile(r"^docs/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md$"),
    # Frontend top-level and component/UI documentation (e.g. frontend/DESIGN.md, frontend/src/ui/README.md)
    re.compile(r"^frontend/[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^frontend/src/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^frontend/packages/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^frontend/packages/[A-Za-z0-9_.-]+/docs/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md$"),
    # Backend documentation (excluding alembic/versions, scripts, tests, configs)
    re.compile(r"^backend/[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^backend/alembic/[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^backend/resources/jars/README\.md$"),
    re.compile(r"^backend/schema/README\.md$"),
    # Ancillary module READMEs
    re.compile(r"^deploy/(?:[A-Za-z0-9_.-]+/)*README\.md$"),
    re.compile(r"^examples/(?:[A-Za-z0-9_.-]+/)*README\.md$"),
    re.compile(r"^website/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md$"),
    re.compile(r"^demo/README\.md$"),
)

DOCS_WITH_OPENAPI_ROUTE_CLAIMS = frozenset(
    {
        "README.md",
        "docs/modules.md",
        "docs/configuration.md",
        "docs/ai-ask-mvp.md",
        "docs/rbac/authenticated-read-model.md",
    }
)

FENCED_CODE_BLOCK_RE = re.compile(r"(?ms)^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n.*?\n[ \t]{0,3}\1[ \t]*$")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
INLINE_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
REFERENCE_LINK_RE = re.compile(r"(?m)^[ \t]{0,3}\[[^\]]+\]:[ \t]*(\S+)")
CONFLICT_MARKER_RE = re.compile(r"(?m)^(?:<{7} |={7}$|>{7} )")


@dataclass(frozen=True)
class DiffEntry:
    old_mode: str
    new_mode: str
    old_sha: str
    new_sha: str
    status: str
    old_path: str
    new_path: str | None = None

    @property
    def effective_path(self) -> str:
        return self.new_path if self.new_path is not None else self.old_path

    @property
    def all_paths(self) -> tuple[str, ...]:
        if self.new_path is not None and self.new_path != self.old_path:
            return (self.old_path, self.new_path)
        return (self.old_path,)


@dataclass(frozen=True)
class ClassificationResult:
    docs_only: bool
    reason: str
    changed_files: tuple[str, ...]
    non_deleted_files: tuple[str, ...] = ()


def is_allowed_doc_path(path: str) -> bool:
    """Return True only if ``path`` is an explicitly allowlisted Markdown doc path."""
    if not path or not isinstance(path, str):
        return False
    if "\\" in path or path.startswith(("/", "./")) or path.endswith("/") or "//" in path:
        return False
    if any(ord(ch) < 32 for ch in path):
        return False

    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False

    filename = parts[-1]
    if not filename.endswith(".md") or filename.startswith(".") or len(filename) <= 3:
        return False
    # Reject compound executable-looking suffixes or uppercase/non-standard extensions.
    if Path(filename).suffix != ".md":
        return False

    if path.startswith(FORBIDDEN_PATH_PREFIXES):
        return False
    dir_segments = parts[:-1]
    if any(seg in FORBIDDEN_DIR_SEGMENTS or seg.startswith(".") for seg in dir_segments):
        return False

    return any(pattern.fullmatch(path) is not None for pattern in ALLOWED_DOC_PATH_PATTERNS)


def parse_raw_diff_z(raw_bytes: bytes) -> list[DiffEntry]:
    """Parse ``git diff --raw -z --no-abbrev --find-renames`` output."""
    if not raw_bytes:
        return []
    tokens = raw_bytes.decode("utf-8", errors="surrogateescape").split("\0")
    # Trailing NUL leaves one empty token at the end.
    if tokens and tokens[-1] == "":
        tokens.pop()

    entries: list[DiffEntry] = []
    idx = 0
    while idx < len(tokens):
        header = tokens[idx]
        idx += 1
        if not header.startswith(":"):
            raise ValueError(f"Malformed git diff --raw header token: {header!r}")
        parts = header[1:].split(" ")
        if len(parts) != 5:
            raise ValueError(f"Unexpected git diff --raw field count in {header!r}")
        old_mode, new_mode, old_sha, new_sha, status = parts
        if idx >= len(tokens):
            raise ValueError("Truncated git diff --raw output (missing path)")
        old_path = tokens[idx]
        idx += 1
        new_path: str | None = None
        if status.startswith(("R", "C")):
            if idx >= len(tokens):
                raise ValueError("Truncated git diff --raw rename/copy output (missing new_path)")
            new_path = tokens[idx]
            idx += 1
        entries.append(
            DiffEntry(
                old_mode=old_mode,
                new_mode=new_mode,
                old_sha=old_sha,
                new_sha=new_sha,
                status=status,
                old_path=old_path,
                new_path=new_path,
            )
        )
    return entries


def parse_numstat_z(numstat_bytes: bytes) -> list[tuple[str, str, str]]:
    """Parse ``git diff --numstat -z --find-renames`` into (added, deleted, path) tuples."""
    if not numstat_bytes:
        return []
    tokens = numstat_bytes.decode("utf-8", errors="surrogateescape").split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()

    stats: list[tuple[str, str, str]] = []
    idx = 0
    while idx < len(tokens):
        record = tokens[idx]
        idx += 1
        fields = record.split("\t", 2)
        if len(fields) != 3:
            raise ValueError(f"Malformed git diff --numstat token: {record!r}")
        added, deleted, path_field = fields
        if path_field == "":
            # Rename/copy in numstat -z puts old_path and new_path in the next two NUL tokens.
            if idx + 1 >= len(tokens):
                raise ValueError("Truncated git diff --numstat rename output")
            _old_path = tokens[idx]
            new_path = tokens[idx + 1]
            idx += 2
            stats.append((added, deleted, new_path))
        else:
            stats.append((added, deleted, path_field))
    return stats


def _validate_markdown_blob_bytes(content: bytes, label: str) -> str | None:
    """Return an error reason if ``content`` is binary, non-UTF-8, or starts with a shebang."""
    if b"\x00" in content:
        return f"binary_nul_byte:{label}"
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return f"invalid_utf8:{label}"
    stripped = text.lstrip("\ufeff")
    if stripped.startswith("#!"):
        return f"executable_shebang_in_doc:{label}"
    return None


def classify_diff_entries(
    entries: list[DiffEntry],
    numstats: list[tuple[str, str, str]],
    blob_reader=None,
    repo_root: Path | None = None,
) -> ClassificationResult:
    """Classify parsed git diff entries with fail-closed semantics."""
    if not entries:
        return ClassificationResult(
            docs_only=False,
            reason="empty_diff_fail_closed",
            changed_files=(),
        )

    for added, deleted, stat_path in numstats:
        if added == "-" or deleted == "-":
            return ClassificationResult(
                docs_only=False,
                reason=f"binary_diff_numstat:{stat_path}",
                changed_files=tuple(sorted({p for e in entries for p in e.all_paths})),
            )

    all_changed: list[str] = []
    non_deleted: list[str] = []

    for entry in entries:
        status_code = entry.status[0] if entry.status else ""
        if status_code not in {"A", "M", "D", "R", "C"}:
            return ClassificationResult(
                docs_only=False,
                reason=f"unsupported_diff_status:{entry.status}:{entry.effective_path}",
                changed_files=tuple(entry.all_paths),
            )

        if entry.old_mode not in REGULAR_FILE_MODES or entry.new_mode not in REGULAR_FILE_MODES:
            return ClassificationResult(
                docs_only=False,
                reason=(
                    f"non_regular_or_executable_mode:{entry.old_mode}->{entry.new_mode}:"
                    f"{entry.effective_path}"
                ),
                changed_files=tuple(entry.all_paths),
            )

        for candidate_path in entry.all_paths:
            if not is_allowed_doc_path(candidate_path):
                return ClassificationResult(
                    docs_only=False,
                    reason=f"disallowed_path:{candidate_path}",
                    changed_files=tuple(entry.all_paths),
                )
            if candidate_path not in all_changed:
                all_changed.append(candidate_path)

        if status_code != "D":
            target_path = entry.effective_path
            if target_path not in non_deleted:
                non_deleted.append(target_path)

            if repo_root is not None:
                disk_path = repo_root / target_path
                if disk_path.is_symlink():
                    return ClassificationResult(
                        docs_only=False,
                        reason=f"symlink_on_disk:{target_path}",
                        changed_files=tuple(all_changed),
                    )
                if disk_path.exists():
                    mode = disk_path.stat().st_mode
                    if mode & 0o111:
                        return ClassificationResult(
                            docs_only=False,
                            reason=f"executable_bit_on_disk:{target_path}",
                            changed_files=tuple(all_changed),
                        )

            if blob_reader is not None:
                blob_bytes = blob_reader(entry.new_sha, target_path)
                if blob_bytes is None:
                    return ClassificationResult(
                        docs_only=False,
                        reason=f"unreadable_blob:{target_path}",
                        changed_files=tuple(all_changed),
                    )
                blob_err = _validate_markdown_blob_bytes(blob_bytes, target_path)
                if blob_err is not None:
                    return ClassificationResult(
                        docs_only=False,
                        reason=blob_err,
                        changed_files=tuple(all_changed),
                    )

    return ClassificationResult(
        docs_only=True,
        reason=f"all_changes_allowed_markdown_docs({len(all_changed)} files)",
        changed_files=tuple(all_changed),
        non_deleted_files=tuple(non_deleted),
    )


def _git(repo_root: Path, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        check=check,
    )


def _commit_exists(repo_root: Path, rev: str) -> bool:
    res = _git(repo_root, ["cat-file", "-e", f"{rev}^{{commit}}"], check=False)
    return res.returncode == 0


def _ensure_commits_available(repo_root: Path, base_sha: str, head_sha: str) -> str | None:
    """Ensure ``base_sha``, ``head_sha``, and their merge-base exist locally. Return merge_base or None."""
    for depth in ("50", "250", None):
        have_base = _commit_exists(repo_root, base_sha)
        have_head = _commit_exists(repo_root, head_sha)
        if have_base and have_head:
            mb = _git(repo_root, ["merge-base", base_sha, head_sha], check=False)
            if mb.returncode == 0:
                merge_base = mb.stdout.decode("utf-8", errors="replace").strip()
                if SHA_RE.fullmatch(merge_base):
                    return merge_base
        fetch_cmd = ["fetch", "--no-tags", "--quiet", "origin"]
        if depth is not None:
            fetch_cmd.extend([f"--depth={depth}"])
        fetch_cmd.extend([base_sha, head_sha])
        _git(repo_root, fetch_cmd, check=False)

    if _commit_exists(repo_root, base_sha) and _commit_exists(repo_root, head_sha):
        mb = _git(repo_root, ["merge-base", base_sha, head_sha], check=False)
        if mb.returncode == 0:
            merge_base = mb.stdout.decode("utf-8", errors="replace").strip()
            if SHA_RE.fullmatch(merge_base):
                return merge_base
    return None


def _resolve_diff_ranges(repo_root: Path, base_sha: str, head_sha: str) -> list[tuple[str, str]]:
    """Return one or more (from_commit, to_commit) ranges to classify."""
    ranges: list[tuple[str, str]] = []

    # Check if HEAD is a GitHub Actions PR test-merge commit where HEAD^2 == head_sha.
    p1 = _git(repo_root, ["rev-parse", "--verify", "HEAD^1"], check=False)
    p2 = _git(repo_root, ["rev-parse", "--verify", "HEAD^2"], check=False)
    if p1.returncode == 0 and p2.returncode == 0:
        parent1 = p1.stdout.decode("utf-8", errors="replace").strip()
        parent2 = p2.stdout.decode("utf-8", errors="replace").strip()
        head_rev = _git(repo_root, ["rev-parse", "--verify", "HEAD"], check=False)
        if (
            head_rev.returncode == 0
            and parent2.lower() == head_sha.lower()
            and SHA_RE.fullmatch(parent1)
        ):
            head_commit = head_rev.stdout.decode("utf-8", errors="replace").strip()
            ranges.append((parent1, head_commit))

    # If both base_sha and head_sha are already locally connected, include (merge_base, head_sha).
    # Only perform network fetches when we do not already have the PR merge-commit parent range.
    if _commit_exists(repo_root, base_sha) and _commit_exists(repo_root, head_sha):
        mb = _git(repo_root, ["merge-base", base_sha, head_sha], check=False)
        if mb.returncode == 0:
            merge_base = mb.stdout.decode("utf-8", errors="replace").strip()
            if SHA_RE.fullmatch(merge_base):
                pair = (merge_base, head_sha)
                if pair not in ranges:
                    ranges.append(pair)
                return ranges

    if not ranges:
        merge_base = _ensure_commits_available(repo_root, base_sha, head_sha)
        if merge_base is not None:
            pair = (merge_base, head_sha)
            if pair not in ranges:
                ranges.append(pair)

    return ranges


def classify_pr_changes(
    *,
    event_name: str,
    base_sha: str,
    head_sha: str,
    repo_root: Path = REPO_ROOT,
) -> ClassificationResult:
    """Classify PR changes in ``repo_root``; fail closed to ``docs_only=False`` on any uncertainty."""
    try:
        normalized_event = (event_name or "").strip()
        if normalized_event != "pull_request":
            return ClassificationResult(
                docs_only=False,
                reason=f"non_pull_request_event:{normalized_event or 'empty'}",
                changed_files=(),
            )

        base = (base_sha or "").strip()
        head = (head_sha or "").strip()
        if not (SHA_RE.fullmatch(base) and SHA_RE.fullmatch(head)):
            return ClassificationResult(
                docs_only=False,
                reason="invalid_or_missing_pr_shas",
                changed_files=(),
            )
        if base.lower() == head.lower():
            return ClassificationResult(
                docs_only=False,
                reason="identical_base_and_head_sha",
                changed_files=(),
            )

        ranges = _resolve_diff_ranges(repo_root, base, head)
        if not ranges:
            return ClassificationResult(
                docs_only=False,
                reason="unable_to_resolve_diff_range",
                changed_files=(),
            )

        combined_entries: list[DiffEntry] = []
        combined_numstats: list[tuple[str, str, str]] = []
        for start_rev, end_rev in ranges:
            raw_proc = _git(
                repo_root,
                ["diff", "--raw", "-z", "--no-abbrev", "--find-renames", start_rev, end_rev],
                check=False,
            )
            num_proc = _git(
                repo_root,
                ["diff", "--numstat", "-z", "--find-renames", start_rev, end_rev],
                check=False,
            )
            if raw_proc.returncode != 0 or num_proc.returncode != 0:
                return ClassificationResult(
                    docs_only=False,
                    reason=f"git_diff_command_failed:{start_rev}..{end_rev}",
                    changed_files=(),
                )
            range_entries = parse_raw_diff_z(raw_proc.stdout)
            range_numstats = parse_numstat_z(num_proc.stdout)
            if not range_entries:
                return ClassificationResult(
                    docs_only=False,
                    reason=f"empty_diff_in_range:{start_rev}..{end_rev}",
                    changed_files=(),
                )
            combined_entries.extend(range_entries)
            combined_numstats.extend(range_numstats)

        def _read_blob(blob_sha: str, rel_path: str) -> bytes | None:
            if blob_sha and set(blob_sha) != {"0"}:
                cat = _git(repo_root, ["cat-file", "-p", blob_sha], check=False)
                if cat.returncode == 0:
                    return cat.stdout
            disk_file = repo_root / rel_path
            if disk_file.is_file() and not disk_file.is_symlink():
                return disk_file.read_bytes()
            return None

        return classify_diff_entries(
            combined_entries,
            combined_numstats,
            blob_reader=_read_blob,
            repo_root=repo_root,
        )
    except Exception as exc:  # Fail closed on any unexpected error.
        return ClassificationResult(
            docs_only=False,
            reason=f"classification_exception:{type(exc).__name__}:{exc}",
            changed_files=(),
        )


def validate_markdown_file_links_and_format(md_path: Path, repo_root: Path = REPO_ROOT) -> list[str]:
    """Validate UTF-8, absence of conflict markers, and local relative links in a Markdown file."""
    errors: list[str] = []
    rel_label = md_path.relative_to(repo_root).as_posix()
    try:
        raw = md_path.read_bytes()
    except OSError as exc:
        return [f"{rel_label}: unable to read file: {exc}"]

    blob_err = _validate_markdown_blob_bytes(raw, rel_label)
    if blob_err is not None:
        return [f"{rel_label}: {blob_err}"]

    text = raw.decode("utf-8")
    without_fences = FENCED_CODE_BLOCK_RE.sub("", text)
    if CONFLICT_MARKER_RE.search(without_fences):
        errors.append(f"{rel_label}: contains unresolved git merge conflict marker")

    without_code = INLINE_CODE_RE.sub("", without_fences)
    raw_targets: list[str] = []
    for match in INLINE_LINK_RE.finditer(without_code):
        raw_targets.append(match.group(1))
    for match in REFERENCE_LINK_RE.finditer(without_code):
        raw_targets.append(match.group(1))

    resolved_root = repo_root.resolve()
    for raw_target in raw_targets:
        target = raw_target.strip()
        if not target:
            continue
        if target.startswith("<") and ">" in target:
            target = target[1 : target.index(">")].strip()
        else:
            target = target.split()[0].strip()

        if not target or target.startswith(("#", "<repo-url>")):
            continue
        lower_target = target.lower()
        if lower_target.startswith(("http://", "https://", "mailto:", "tel:", "data:", "javascript:")):
            continue

        path_part = re.split(r"[?#]", target, maxsplit=1)[0].strip()
        if not path_part:
            continue
        path_part = unquote(path_part)

        if path_part.startswith("/"):
            errors.append(f"{rel_label}: absolute link path is not portable: {raw_target}")
            continue

        candidate = (md_path.parent / path_part).resolve()
        if not candidate.is_relative_to(resolved_root):
            errors.append(f"{rel_label}: link escapes repository root: {raw_target}")
            continue
        if not candidate.exists():
            errors.append(f"{rel_label}: broken local link target: {raw_target}")

    return errors


def check_public_docs_prose_contracts(repo_root: Path = REPO_ROOT) -> list[str]:
    """Stdlib-only prose consistency checks mirroring test_public_docs_consistency.py."""
    errors: list[str] = []

    def _read_rel(rel: str) -> str:
        return (repo_root / rel).read_text(encoding="utf-8")

    try:
        readme = _read_rel("README.md")
        for endpoint in (
            "/api/search",
            "/api/search/recommendations",
            "/api/ai/status",
            "/api/ai/ask",
            "/api/ai/ask/progress",
            "/api/ai/ask/stream",
        ):
            if endpoint not in readme:
                errors.append(f"README.md must document {endpoint}")

        for required_phrase in ("不依赖 RAG", "不依赖 LLM", "/api/ai/ask/stream", "兼容接口"):
            if required_phrase not in readme:
                errors.append(f"README.md missing required phrase: {required_phrase}")

        expectations = {
            "README.md": "AI_ASK_ENABLED` 默认 `false",
            "docs/configuration.md": "disabled by default",
            "docs/ai-ask-mvp.md": "默认关闭",
            "DEPLOYMENT.md": "`AI_ASK_ENABLED` unset or `false` by default",
        }
        for rel, wording in expectations.items():
            text = _read_rel(rel)
            if "AI_ASK_ENABLED" not in text or "false" not in text or wording not in text:
                errors.append(f"{rel} must state AI_ASK_ENABLED disabled default ({wording!r})")

        if "向量检索、Embedding 与 LLM 语义推荐" in readme:
            errors.append("README.md must not re-assert retired out-of-scope AI claim")
        for token in ("不内置", "NL2SQL", "可选"):
            if token not in readme:
                errors.append(f"README.md missing scope boundary token: {token}")

        for required_demo_claim in (
            "https://data.overme.cn/",
            "使用真实 DAP 后端和 Remote API",
            "在线演示站使用真实 AI 问答吗",
            "docs/ai-ask-static-mock.md",
            "不调用任何 RAG 服务或 LLM",
        ):
            if required_demo_claim not in readme:
                errors.append(f"README.md missing public demo claim: {required_demo_claim}")

        for forbidden_demo_claim in (
            "静态 mock bundle",
            "公网静态 Demo",
            "公网静态 Demo 用的是真实 DeepSeek 吗",
        ):
            if forbidden_demo_claim in readme:
                errors.append(f"README.md contains retired static demo claim: {forbidden_demo_claim}")

        static_mock = _read_rel("docs/ai-ask-static-mock.md")
        for token in ("不会执行真实 AI", "VITE_API_MODE=mock"):
            if token not in static_mock:
                errors.append(f"docs/ai-ask-static-mock.md missing {token}")
    except OSError as exc:
        errors.append(f"missing or unreadable required documentation file: {exc}")

    return errors


def evaluate_frontend_gate(
    *,
    event_name: str,
    docs_only: str,
    guard_result: str,
    core_result: str,
    browser_result: str,
) -> tuple[bool, str]:
    """Evaluate the `Frontend / Node 22` required check aggregator gate.

    Rules:
      1. `Repository Guard` (`guard_result`) must always be `success`.
      2. If `core_result == 'success'` and `browser_result == 'success'`, pass.
      3. On a `pull_request` where `docs_only == 'true'` and `guard_result == 'success'`,
         pass if and only if both `core_result` and `browser_result` are `'skipped'`.
         If either job actually ran and failed/cancelled/timed out, fail.
      4. In all other cases (non-PR events, `docs_only != 'true'`, or any failure/cancel/skip),
         fail closed.
    """
    norm_event = (event_name or "").strip()
    norm_docs_only = (docs_only or "").strip().lower()
    norm_guard = (guard_result or "").strip()
    norm_core = (core_result or "").strip()
    norm_browser = (browser_result or "").strip()

    summary = (
        f"event={norm_event or 'unknown'} docs_only={norm_docs_only or 'false'} "
        f"guard={norm_guard or 'none'} core={norm_core or 'none'} browser={norm_browser or 'none'}"
    )

    if norm_guard != "success":
        return False, f"FAIL ({summary}): Repository Guard did not succeed"

    if norm_core == "success" and norm_browser == "success":
        return True, f"PASS ({summary}): Frontend core and all browser shards succeeded"

    if (
        norm_event == "pull_request"
        and norm_docs_only == "true"
        and norm_core == "skipped"
        and norm_browser == "skipped"
    ):
        return (
            True,
            f"PASS ({summary}): Docs-only fast path verified by Repository Guard; heavy frontend jobs skipped",
        )

    return (
        False,
        f"FAIL ({summary}): Frontend core and browser shards must both succeed unless skipped on a verified docs-only PR",
    )


def _write_github_output(github_output: str | None, values: dict[str, str]) -> None:
    if not github_output:
        return
    output_path = Path(github_output)
    with output_path.open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            safe_val = str(value).replace("\r", " ").replace("\n", " ")
            handle.write(f"{key}={safe_val}\n")


def _cmd_classify(args: argparse.Namespace) -> int:
    result = classify_pr_changes(
        event_name=args.event_name,
        base_sha=args.base_sha,
        head_sha=args.head_sha,
        repo_root=Path(args.repo_root).resolve(),
    )
    docs_only_str = "true" if result.docs_only else "false"
    print(f"docs_only={docs_only_str}")
    print(f"reason={result.reason}")
    if result.changed_files:
        print(f"changed_files ({len(result.changed_files)}): {', '.join(result.changed_files)}")
    _write_github_output(
        args.github_output,
        {
            "docs_only": docs_only_str,
            "classification_reason": result.reason,
        },
    )
    # Classification always exits 0 and fails closed (`docs_only=false`) on errors.
    return 0


def _cmd_check_docs(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root).resolve()
    result = classify_pr_changes(
        event_name=args.event_name,
        base_sha=args.base_sha,
        head_sha=args.head_sha,
        repo_root=repo_root,
    )

    # 1. If we have a valid PR diff range, run `git diff --check` across the commit range
    # and scan every changed Markdown file for broken links, conflict markers, and safety findings.
    from safety_scan import high_severity, scan_file  # noqa: E402

    ranges = (
        _resolve_diff_ranges(repo_root, args.base_sha.strip(), args.head_sha.strip())
        if args.event_name == "pull_request"
        and SHA_RE.fullmatch((args.base_sha or "").strip())
        and SHA_RE.fullmatch((args.head_sha or "").strip())
        else []
    )
    for start_rev, end_rev in ranges:
        diff_check = _git(repo_root, ["diff", "--check", start_rev, end_rev], check=False)
        if diff_check.returncode != 0:
            sys.stderr.write(diff_check.stdout.decode("utf-8", errors="replace"))
            sys.stderr.write(diff_check.stderr.decode("utf-8", errors="replace"))
            print(f"FAIL: git diff --check failed on range {start_rev}..{end_rev}")
            return 1

    changed_md_files = [
        rel for rel in result.non_deleted_files if rel.endswith(".md") and (repo_root / rel).is_file()
    ]
    errors: list[str] = []
    for rel_path in changed_md_files:
        md_file = repo_root / rel_path
        errors.extend(validate_markdown_file_links_and_format(md_file, repo_root))
        findings = high_severity(scan_file(md_file, repo_root))
        for finding in findings:
            errors.append(
                f"{rel_path}: Public Data Guard {finding['severity']} [{finding['category']}]: {finding['detail']}"
            )

    # 2. Always verify public documentation prose contracts and stdlib doc/safety unit tests.
    errors.extend(check_public_docs_prose_contracts(repo_root))
    if errors:
        for err in errors:
            print(f"FAIL: {err}")
        return 1

    if str(args.docs_only).strip().lower() == "true" or result.docs_only:
        suite = unittest.defaultTestLoader.loadTestsFromNames(
            [
                "backend.tests.test_repo_safety_guard",
                "backend.tests.test_packaging_contracts",
                "backend.tests.test_configuration_surface",
                "backend.tests.test_lineage_rollback_sql_contract",
            ]
        )
        runner = unittest.TextTestRunner(verbosity=1)
        test_result = runner.run(suite)
        if not test_result.wasSuccessful():
            return 1

        # If any OpenAPI route-claim doc was modified in a docs-only PR, also run
        # test_public_docs_consistency against the FastAPI OpenAPI table.
        if set(result.changed_files) & DOCS_WITH_OPENAPI_ROUTE_CLAIMS:
            try:
                import fastapi  # noqa: F401
            except ImportError:
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-r", str(repo_root / "backend/requirements.txt")],
                    cwd=repo_root,
                    check=True,
                )
            route_suite = unittest.defaultTestLoader.loadTestsFromName(
                "backend.tests.test_public_docs_consistency"
            )
            if not runner.run(route_suite).wasSuccessful():
                return 1

    print(
        f"PASS: docs guard checks succeeded (checked {len(changed_md_files)} changed Markdown file(s))."
    )
    return 0


def _cmd_evaluate_frontend_gate(args: argparse.Namespace) -> int:
    ok, message = evaluate_frontend_gate(
        event_name=args.event_name,
        docs_only=args.docs_only,
        guard_result=args.guard_result,
        core_result=args.core_result,
        browser_result=args.browser_result,
    )
    print(message)
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CI docs-only PR classification and gate helper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    classify_parser = subparsers.add_parser("classify", help="Classify PR diff (fail-closed).")
    classify_parser.add_argument("--event-name", default=os.getenv("GITHUB_EVENT_NAME", ""))
    classify_parser.add_argument("--base-sha", default=os.getenv("GITHUB_BASE_SHA", ""))
    classify_parser.add_argument("--head-sha", default=os.getenv("GITHUB_HEAD_SHA", ""))
    classify_parser.add_argument("--repo-root", default=str(REPO_ROOT))
    classify_parser.add_argument("--github-output", default=os.getenv("GITHUB_OUTPUT", ""))
    classify_parser.set_defaults(func=_cmd_classify)

    check_parser = subparsers.add_parser("check-docs", help="Run docs-only format, link, and safety checks.")
    check_parser.add_argument("--event-name", default=os.getenv("GITHUB_EVENT_NAME", ""))
    check_parser.add_argument("--base-sha", default=os.getenv("GITHUB_BASE_SHA", ""))
    check_parser.add_argument("--head-sha", default=os.getenv("GITHUB_HEAD_SHA", ""))
    check_parser.add_argument("--docs-only", default=os.getenv("DOCS_ONLY", "false"))
    check_parser.add_argument("--repo-root", default=str(REPO_ROOT))
    check_parser.set_defaults(func=_cmd_check_docs)

    gate_parser = subparsers.add_parser(
        "evaluate-frontend-gate",
        help="Evaluate Frontend / Node 22 required check gate.",
    )
    gate_parser.add_argument("--event-name", default=os.getenv("EVENT_NAME", ""))
    gate_parser.add_argument("--docs-only", default=os.getenv("DOCS_ONLY", "false"))
    gate_parser.add_argument("--guard-result", default=os.getenv("GUARD_RESULT", ""))
    gate_parser.add_argument("--core-result", default=os.getenv("CORE_RESULT", ""))
    gate_parser.add_argument("--browser-result", default=os.getenv("BROWSER_RESULT", ""))
    gate_parser.set_defaults(func=_cmd_evaluate_frontend_gate)

    parsed = parser.parse_args(argv)
    return parsed.func(parsed)


if __name__ == "__main__":
    raise SystemExit(main())
