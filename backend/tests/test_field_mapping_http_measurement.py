import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from backend.scripts.measure_field_mapping_http import measure


class MeasurementTests(unittest.TestCase):
    def test_remote_origins_are_rejected_before_any_request(self):
        for origin in ("https://example.com", "http://user:secret@localhost", "http://localhost?redirect=1"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                measure(origin, {}, 2)

    def test_measurement_is_read_only_and_compares_all_sample_counts(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                key = "fieldCount" if urlsplit(self.path).path.endswith("stats") else "total"
                payload = json.dumps({key: 7}).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = measure(f"http://127.0.0.1:{server.server_port}", {"sourceSystemId": "approved-test-id"}, 2)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()
        self.assertTrue(result["field_stats_consistent"])
        self.assertTrue(result["stable_counts"])
        self.assertNotIn("stable_snapshot", result)
        self.assertEqual(6, len(requests))
        self.assertTrue(all(parse_qs(urlsplit(path).query)["sourceSystemId"] == ["approved-test-id"] for path in requests))
        self.assertNotIn("approved-test-id", json.dumps(result))
