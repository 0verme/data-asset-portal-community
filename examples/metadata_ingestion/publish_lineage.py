#!/usr/bin/env python3
"""Publish a public lineage JSON Contract to DAP over HTTP."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen


def publish(dap_url: str, payload: dict, *, session_cookie: str = "") -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if session_cookie:
        headers["Cookie"] = f"session={session_cookie}"
    request = Request(dap_url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=60) as response:
        return response.status, response.read().decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish a lineage Contract JSON file to DAP")
    parser.add_argument("payload", type=Path, help="Path to a public lineage Contract JSON file")
    parser.add_argument("--dap-url", required=True, help="DAP lineage ingestion URL")
    parser.add_argument("--session-cookie", default="", help="Optional signed session value supplied by the deployment")
    args = parser.parse_args()

    try:
        payload = json.loads(args.payload.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Unable to read lineage Contract JSON: {args.payload}") from error
    status, response = publish(args.dap_url, payload, session_cookie=args.session_cookie)
    print(json.dumps({"status": status, "response": response}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
