"""Read-only loopback measurement for an explicitly prepared non-production server.

Never exports response rows, credentials, or business filter values.
HTTP timing includes COUNT and serialization; it is not a database query profile.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def measure(base_url, filters, samples):
    origin = urlsplit(base_url)
    if origin.scheme != "http" or origin.hostname not in {"127.0.0.1", "localhost", "::1"} or origin.username or origin.password or origin.query or origin.fragment:
        raise ValueError("Use an explicit loopback HTTP non-production server")
    headers = {"Accept": "application/json"}
    token = os.environ.get("DAP_MEASURE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    opener = build_opener(ProxyHandler({}), NoRedirect)
    measurements = {}
    totals = {}
    for endpoint in ("tables", "fields", "stats"):
        durations = []
        for _ in range(samples):
            params = dict(filters)
            if endpoint != "stats":
                params.update(page=1, pageSize=50)
            url = f"{base_url.rstrip('/')}/api/field-mappings/{endpoint}?{urlencode(params)}"
            start = time.perf_counter()
            with opener.open(Request(url, headers=headers), timeout=60) as response:
                payload = json.load(response)
            durations.append(round((time.perf_counter() - start) * 1000, 2))
            data = payload.get("data", payload)
            total = data.get("fieldCount" if endpoint == "stats" else "total")
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise ValueError(f"{endpoint}: missing nonnegative integer count")
            totals.setdefault(endpoint, []).append(total)
        measurements[endpoint] = {"first_ms": durations[0], "median_ms": statistics.median(durations), "p95_ms": sorted(durations)[math.ceil(.95 * samples) - 1], "samples_ms": durations}
    stable = all(len(set(values)) == 1 for values in totals.values())
    return {"environment": "NON_PRODUCTION_LOOPBACK", "cache_state": "UNKNOWN", "http": measurements,
            "counts": totals, "stable_counts": stable,
            "field_stats_consistent": stable and totals["fields"][0] == totals["stats"][0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--source-system-id")
    args = parser.parse_args()
    if not 2 <= args.samples <= 30:
        parser.error("samples must be between 2 and 30")
    filters = {"sourceSystemId": args.source_system_id} if args.source_system_id else {}
    try:
        result = measure(args.base_url, filters, args.samples)
    except Exception as error:
        # Exceptions may contain a request URL or authentication details.
        parser.exit(1, f"Measurement failed ({type(error).__name__}); inspect the non-production server locally.\n")
    print(json.dumps(result, indent=2))
    return 0 if result["field_stats_consistent"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
