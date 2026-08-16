#!/usr/bin/env python
"""Collect a controlled table/job lineage snapshot from scheduler metadata."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.lineage_collector import collect_and_publish  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True, help="Configured source and lineage database profile")
    parser.add_argument("--dry-run", action="store_true", help="Build and validate without publishing")
    args = parser.parse_args(argv)
    snapshot = collect_and_publish(args.profile, dry_run=args.dry_run)
    summary = {
        "action": "dry-run" if args.dry_run else "publish",
        "snapshotId": snapshot["snapshotId"],
        "nodes": len(snapshot["nodes"]),
        "edges": len(snapshot["edges"]),
        "diagnostics": len(snapshot["diagnostics"]),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
