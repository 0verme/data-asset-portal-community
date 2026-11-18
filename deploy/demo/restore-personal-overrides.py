#!/usr/bin/env python3
"""Reapply the deployment's server-local RAG override through DAP validation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def restore_rag_override(path: Path) -> None:
    from backend.app.contracts.rag_search import RagSearchConfig, RagSearchConfigUpdate
    from backend.app.services.system_management_service import system_management_service
    from backend.app.settings import get_rag_search_service_token

    if not get_rag_search_service_token():
        raise RuntimeError("RAG deployment secret is not configured")

    desired = json.loads(path.read_text(encoding="utf-8"))["rag"]
    # The update API distinguishes an omitted mode from an explicit null.
    # Preserve that distinction and leave other omitted settings untouched.
    patch = RagSearchConfigUpdate.model_validate(desired).model_dump(
        by_alias=True, exclude_unset=True
    )
    current = system_management_service.get_rag_search_config()
    expected = RagSearchConfig.model_validate({**current, **patch}).model_dump(by_alias=True)
    if current != expected:
        system_management_service.update_rag_search_config(
            patch, system_actor="server-deployment"
        )
    if system_management_service.get_rag_search_config() != expected:
        raise RuntimeError("Persisted RAG configuration differs from the override")


def main() -> int:
    script = Path(__file__)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--overrides", type=Path,
        default=script.absolute().with_name("personal-overrides.json"),
    )
    overrides = parser.parse_args().overrides.resolve()
    repo = script.resolve().parents[2]
    os.chdir(repo)
    sys.path.insert(0, str(repo))

    try:
        from backend.app.settings import load_runtime_env

        load_runtime_env()
        restore_rag_override(overrides)
    except Exception as exc:
        # Validation inputs can contain sensitive deployment material.
        print(
            f"ERROR: could not restore server-local RAG configuration ({type(exc).__name__})",
            file=sys.stderr,
        )
        return 1

    print("Server-local RAG configuration verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
