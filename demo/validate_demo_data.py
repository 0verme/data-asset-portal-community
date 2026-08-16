#!/usr/bin/env python3
"""Read-only safety and consistency validation for all public demo surfaces.

Two layers:
  1. Demo dataset validation (relation integrity + min counts + retail theme).
  2. Repository Public Data Guard: scans docs / configs / scripts / demo /
     frontend data for private IPs, internal domains, secrets, local paths
     and business-sensitive residue. Findings are classified
     SAFE / EXPECTED / SUSPICIOUS / BLOCKER; BLOCKER must be zero.

Usage:
  python demo/validate_demo_data.py            # whole guard
  python demo/validate_demo_data.py --dirs-only  # demo validation only
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


from safety_scan import GUARD_DIRS, GUARD_FILES, scan_file

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
PRIVATE_IPV4 = None  # kept for compatibility; real checks live in safety_scan

# Files that are themselves the scanner or internal audit archives: skipped by
# the whole-repo guard (they contain detection patterns / audit notes, not
# repository data). The audit archive must be moved out before public release.
SKIP_GUARD_PATHS = {
    "demo/safety_scan.py",
    "demo/validate_demo_data.py",
    "backend/tests/test_repo_safety_guard.py",
    "docs/open-source-readiness-audit.md",
}

FORBIDDEN_TERMS = ("银行", "贷款", "存款", "监管", "支行", "反洗钱", "授信", "借据", ".intra", "SFTP")

PUBLIC_FRONTEND_FILES = [
    *(REPO_ROOT / "frontend" / "src" / "data").glob("*.js"),
    REPO_ROOT / "frontend" / "src" / "api" / "lineage.js",
    REPO_ROOT / "frontend" / "src" / "config" / "assets.js",
    REPO_ROOT / "frontend" / "src" / "config" / "defaults.js",
    REPO_ROOT / "frontend" / "src" / "config" / "portalSearch.js",
    REPO_ROOT / "frontend" / "src" / "api" / "portal.js",
    REPO_ROOT / "frontend" / "src" / "components" / "IndicatorEditor.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "IndicatorPage.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "upstream" / "UpstreamEditor.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "push" / "SystemEditor.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "push" / "pushConstants.js",
    REPO_ROOT / "frontend" / "src" / "components" / "LineagePage.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "app" / "ModuleSidebar.jsx",
    REPO_ROOT / "frontend" / "src" / "components" / "fieldMapping" / "FieldMappingControls.jsx",
]

MINIMUM_COUNTS = {
    "systems.json": 8,
    "data_sources.json": 8,
    "assets.json": 16,
    "roots.json": 40,
    "indicators.json": 16,
    "mappings.json": 8,
    "lineage.json": 7,
    "api_assets.json": 10,
    "reports.json": 8,
    "push_systems.json": 6,
}


def load_datasets():
    try:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        datasets = {}
        for relative in manifest["datasets"]:
            datasets[Path(relative).name] = json.loads(
                (ROOT / relative).read_text(encoding="utf-8")
            )
    except (OSError, ValueError, KeyError) as exc:
        raise SystemExit(f"无法加载 demo 数据集（manifest.json 或数据集缺失/损坏）: {exc}") from exc
    return manifest, datasets


def validate_relations(datasets):
    risks = []
    system_ids = {item["id"] for item in datasets["systems.json"]}
    source_ids = {item["id"] for item in datasets["data_sources.json"]}
    indicator_codes = {item["code"] for item in datasets["indicators.json"]}
    report_codes = {item["code"] for item in datasets["reports.json"]}

    for item in datasets["api_assets.json"]:
        if item["systemId"] not in system_ids:
            risks.append(f"api_assets.json: unknown systemId {item['systemId']}")
    for item in datasets["mappings.json"]:
        if item["dataSourceId"] not in source_ids:
            risks.append(f"mappings.json: unknown dataSourceId {item['dataSourceId']}")
        field_ids = [field["id"] for field in item.get("fields", [])]
        if len(field_ids) != len(set(field_ids)):
            risks.append(f"mappings.json: duplicate field id in mapping {item['id']}")
    lineage_targets = {item["target"] for item in datasets["lineage.json"]}
    if not indicator_codes.intersection(lineage_targets):
        risks.append("lineage.json: no indicator target")
    if not report_codes.intersection(lineage_targets):
        risks.append("lineage.json: no report target")
    return risks


def validate_demo_surfaces():
    """Original demo + frontend data validation. Returns list of risk strings."""
    risks = []
    manifest, datasets = load_datasets()
    if manifest.get("version") != 2 or "全渠道零售" not in manifest.get("theme", ""):
        risks.append("manifest.json: expected version 2 full-channel retail theme")
    for name, minimum in MINIMUM_COUNTS.items():
        actual = len(datasets.get(name, []))
        if actual < minimum:
            risks.append(f"datasets/{name}: expected at least {minimum}, got {actual}")
    risks.extend(validate_relations(datasets))

    dataset_files = [ROOT / relative for relative in manifest["datasets"]]
    seed_files = [ROOT / "seed_postgres.py", ROOT / "seed_sqlite.py"]
    for path in [*dataset_files, *PUBLIC_FRONTEND_FILES, *seed_files]:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        for term in FORBIDDEN_TERMS:
            if term.lower() in text.lower():
                risks.append(f"{path.relative_to(REPO_ROOT).as_posix()}: forbidden term {term}")
    return risks


def collect_guard_files():
    """All files under the guard surface, tracked by git only."""
    tracked = set(
        subprocess.check_output(
            ["git", "ls-files", "-z"], cwd=REPO_ROOT, text=True
        ).split("\0")
    )
    paths = []
    for rel_dir in GUARD_DIRS:
        base = REPO_ROOT / rel_dir
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in SKIP_GUARD_PATHS or rel not in tracked:
                continue
            if path.is_file() and path.suffix.lower() in (
                ".md", ".py", ".sql", ".yaml", ".yml", ".json", ".js", ".jsx",
                ".ts", ".tsx", ".txt", ".env", ".example", ".sh", ".ps1",
            ):
                paths.append(path)
    for rel in GUARD_FILES:
        path = REPO_ROOT / rel
        if path.exists() and rel not in SKIP_GUARD_PATHS:
            paths.append(path)
    return paths


def run_public_data_guard():
    """Scan the whole guard surface. Returns (findings, file_count)."""
    findings = []
    files = collect_guard_files()
    for path in files:
        findings.extend(scan_file(path, REPO_ROOT))
    return findings, len(files)


def main():
    parser = argparse.ArgumentParser(description="Validate public demo surfaces.")
    parser.add_argument("--dirs-only", action="store_true", help="Only validate demo datasets (skip whole-repo guard).")
    args = parser.parse_args()

    risks = validate_demo_surfaces()
    if risks:
        print("\n".join(risks))
        print(f"演示数据风险数量：{len(risks)}")
        return 1

    if args.dirs_only:
        print("演示数据校验通过：无风险")
        return 0

    findings, file_count = run_public_data_guard()
    blockers = [f for f in findings if f["severity"] == "BLOCKER"]
    suspicious = [f for f in findings if f["severity"] == "SUSPICIOUS"]
    expected = [f for f in findings if f["severity"] == "EXPECTED"]
    safe = [f for f in findings if f["severity"] == "SAFE"]

    print(f"扫描文件数：{file_count}")
    print(f"BLOCKER    : {len(blockers)}")
    print(f"SUSPICIOUS : {len(suspicious)}")
    print(f"EXPECTED   : {len(expected)}")
    print(f"SAFE       : {len(safe)}")
    if suspicious:
        print("\n-- SUSPICIOUS --")
        for f in suspicious[:50]:
            print(f"  [{f['severity']}] {f['label']}: {f['detail']}")
    if blockers:
        print("\n-- BLOCKER --")
        for f in blockers[:50]:
            print(f"  [{f['severity']}] {f['label']}: {f['detail']}")

    print(f"\nRepository Public Data Guard: 高置信风险(BLOCKER) = {len(blockers)}")
    if blockers:
        print("FAIL：存在 BLOCKER 级别发现，请先处理再提交。")
        return 2
    print("PASS：无 BLOCKER 级别发现。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
