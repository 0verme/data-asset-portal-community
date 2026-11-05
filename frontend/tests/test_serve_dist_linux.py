"""Disposable real-socket probes for the reconstructed Linux proxy.

This file and all generated fixtures are local test assets; do not commit them.
"""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCRIPT = Path(os.environ.get(
    "SERVE_DIST_SCRIPT",
    Path(__file__).resolve().parents[1] / "serve-dist-linux.py",
)).resolve()


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.stream_times: list[float] = []
        self.active_streams = 0
        self.stream_closed = threading.Event()

    def add_stream(self):
        with self.lock:
            self.active_streams += 1

    def close_stream(self):
        with self.lock:
            self.active_streams -= 1
            if self.active_streams == 0:
                self.stream_closed.set()


class BackendHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    state: State

    def log_message(self, *_args):
        pass

    def _json(self, status: int, body: object, cookies: tuple[str, ...] = ()):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def do_GET(self):
        if self.path in ("/api/stream", "/api/stream-error"):
            self.send_response(503 if self.path.endswith("stream-error") else 200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for number in range(3):
                    time.sleep(0.32)
                    self.state.stream_times.append(time.monotonic())
                    event = f"data: event-{number}\n\n".encode()
                    self.wfile.write(f"{len(event):x}\r\n".encode() + event + b"\r\n")
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                self.close_connection = True
            return
        if self.path == "/api/redirect":
            self.send_response(302)
            self.send_header("Location", "/api/json")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/api/long-stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.state.add_stream()
            try:
                number = 0
                while number < 200:
                    self.wfile.write(f"data: keep-{number}\n\n".encode())
                    self.wfile.flush()
                    number += 1
                    time.sleep(0.04)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                self.close_connection = True
                self.state.close_stream()
            return
        if self.path == "/api/upstream-abort":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            chunk = b"data: partial\n\n"
            self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
            self.wfile.flush()
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            self.close_connection = True
            return
        if self.path == "/api/json":
            self._json(200, {"ok": True, "kind": "json"}, ("session=one; Path=/", "theme=blue; Path=/"))
            return
        if self.path == "/api/error":
            self._json(409, {"error": "conflict"})
            return
        if self.path == "/api/echo":
            self._json(200, {
                "method": self.command,
                "path": self.path,
                "cookie": self.headers.get("Cookie"),
                "authorization": self.headers.get("Authorization"),
                "forwarded_for": self.headers.get("X-Forwarded-For"),
                "forwarded_proto": self.headers.get("X-Forwarded-Proto"),
                "forwarded": self.headers.get("Forwarded"),
                "accept_encoding": self.headers.get("Accept-Encoding"),
                "body": "",
            })
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/api/echo":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            self._json(200, {
                "method": self.command,
                "path": self.path,
                "cookie": self.headers.get("Cookie"),
                "authorization": self.headers.get("Authorization"),
                "forwarded_for": self.headers.get("X-Forwarded-For"),
                "forwarded_proto": self.headers.get("X-Forwarded-Proto"),
                "forwarded": self.headers.get("Forwarded"),
                "accept_encoding": self.headers.get("Accept-Encoding"),
                "body": body.decode("utf-8"),
            })
            return
        self._json(404, {"error": "not found"})


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ProxyHarness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="dap-proxy-probe-")
        self.root = Path(self.tmp.name)
        self.dist = self.root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<!doctype html><title>probe-spa</title>")
        (self.dist / "assets" / "app.js").write_text("window.probe = true;")
        self.outside = self.root / "outside.txt"
        self.outside.write_text("OUTSIDE_SENTINEL_MUST_NEVER_BE_SERVED")
        try:
            (self.dist / "assets" / "outside-link.txt").symlink_to(self.outside)
        except (OSError, NotImplementedError):
            pass

        self.state = State()
        handler = type("ProbeBackendHandler", (BackendHandler,), {"state": self.state})
        self.backend = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.backend.daemon_threads = True
        self.backend_thread = threading.Thread(target=self.backend.serve_forever, daemon=True)
        self.backend_thread.start()
        self.backend_url = f"http://127.0.0.1:{self.backend.server_port}"
        self.proxy = None
        self.proxy_port = None
        self.start_proxy()

    def tearDown(self):
        if self.proxy is not None:
            self.proxy.terminate()
            try:
                self.proxy.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proxy.kill()
                self.proxy.wait(timeout=3)
            if self.proxy.stderr:
                self.proxy.stderr.close()
        self.backend.shutdown()
        self.backend.server_close()
        self.backend_thread.join(timeout=2)
        self.tmp.cleanup()

    def start_proxy(self, *, env_extra=None, cwd=None, script=None):
        self.proxy_port = free_port()
        env = os.environ.copy()
        env.update({
            "DAP_FRONTEND_DIST": str(self.dist),
            "DAP_BACKEND_URL": self.backend_url,
            "DAP_HOST": "127.0.0.1",
            "DAP_PORT": str(self.proxy_port),
        })
        if env_extra:
            env.update(env_extra)
        self.proxy = subprocess.Popen(
            [sys.executable, str(script or SCRIPT)],
            cwd=str(cwd or self.root), env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if self.proxy.poll() is not None:
                stderr = self.proxy.stderr.read().decode(errors="replace")
                self.fail(f"proxy exited during startup: {stderr}")
            try:
                with socket.create_connection(("127.0.0.1", self.proxy_port), timeout=0.1):
                    return
            except OSError:
                time.sleep(0.025)
        self.fail("proxy did not start")

    def request(self, method, path, *, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.proxy_port, timeout=4)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return connection, response

    def start_aux_proxy(self, *, script, cwd, dist_value, backend_url=None):
        port = free_port()
        env = os.environ.copy()
        env.pop("DAP_FRONTEND_DIST", None)
        env.update({"DAP_HOST": "127.0.0.1", "DAP_PORT": str(port)})
        if dist_value is not None:
            env["DAP_FRONTEND_DIST"] = dist_value
        env["DAP_BACKEND_URL"] = backend_url or self.backend_url
        process = subprocess.Popen(
            [sys.executable, str(script)], cwd=str(cwd), env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if process.poll() is not None:
                stderr = process.stderr.read().decode(errors="replace")
                self.fail(f"auxiliary proxy exited during startup: {stderr}")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    return process, port
            except OSError:
                time.sleep(0.025)
        process.terminate()
        process.wait(timeout=3)
        self.fail("auxiliary proxy did not start")

    def test_sse_events_are_delivered_while_upstream_is_still_running(self):
        connection, response = self.request("GET", "/api/stream")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Transfer-Encoding", "").lower(), "chunked")
        self.assertIsNone(response.getheader("Content-Length"))
        self.assertEqual(response.getheader("Connection", "").lower(), "close")
        self.assertIn("text/event-stream", response.getheader("Content-Type", ""))

        events: list[tuple[str, float]] = []
        pending = bytearray()
        deadline = time.monotonic() + 3
        while len(events) < 3 and time.monotonic() < deadline:
            chunk = response.read1(4096)
            if not chunk:
                break
            pending.extend(chunk)
            while b"\n\n" in pending:
                raw, _, rest = pending.partition(b"\n\n")
                pending = bytearray(rest)
                events.append((raw.decode(), time.monotonic()))
        connection.close()
        self.assertEqual([item[0] for item in events], [f"data: event-{i}" for i in range(3)])
        sent = self.state.stream_times
        self.assertEqual(len(sent), 3)
        self.assertLess(events[0][1] - sent[0], 0.25, "first event must reach the client before the stream finishes")
        arrivals = [item[1] for item in events]
        self.assertGreater(arrivals[1] - arrivals[0], 0.15, "events must preserve upstream time gaps")
        self.assertGreater(arrivals[2] - arrivals[1], 0.15, "events must preserve upstream time gaps")

    def test_sse_error_status_is_streamed_and_keeps_status(self):
        connection, response = self.request("GET", "/api/stream-error")
        self.assertEqual(response.status, 503)
        self.assertEqual(response.getheader("Transfer-Encoding", "").lower(), "chunked")
        first = response.read1(4096)
        self.assertIn(b"data: event-0", first)
        self.assertLess(time.monotonic() - self.state.stream_times[0], 0.25)
        body = first
        while True:
            chunk = response.read1(4096)
            if not chunk:
                break
            body += chunk
        self.assertIn(b"data: event-2", body)
        connection.close()

    def test_json_static_spa_cookie_and_error_compatibility(self):
        connection, response = self.request("GET", "/api/json")
        body = response.read()
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"ok": True, "kind": "json"})
        cookies = response.headers.get_all("Set-Cookie")
        self.assertEqual(cookies, ["session=one; Path=/", "theme=blue; Path=/"])
        self.assertEqual(int(response.getheader("Content-Length")), len(body))
        connection.close()

        for path, expected in (("/", "probe-spa"), ("/assets/app.js", "window.probe"), ("/client/route", "probe-spa")):
            connection, response = self.request("GET", path)
            payload = response.read().decode()
            self.assertEqual(response.status, 200)
            self.assertIn(expected, payload)
            connection.close()

        connection, response = self.request("GET", "/api/error")
        self.assertEqual(response.status, 409)
        self.assertEqual(json.loads(response.read()), {"error": "conflict"})
        connection.close()

        connection, response = self.request("GET", "/api/redirect")
        self.assertEqual(response.status, 302)
        self.assertEqual(response.getheader("Location"), "/api/json")
        self.assertEqual(response.read(), b"")
        connection.close()

    def test_request_cookie_authorization_and_json_body_are_forwarded(self):
        payload = json.dumps({"question": "test"})
        connection, response = self.request(
            "POST", "/api/echo", body=payload,
            headers={
                "Content-Type": "application/json", "Cookie": "session=probe",
                "Authorization": "Bearer safe-probe", "X-Forwarded-For": "203.0.113.99",
                "X-Forwarded-Proto": "https", "Forwarded": "for=203.0.113.99;proto=https",
            },
        )
        actual = json.loads(response.read())
        self.assertEqual(response.status, 200)
        self.assertEqual(actual["method"], "POST")
        self.assertEqual(actual["body"], payload)
        self.assertEqual(actual["cookie"], "session=probe")
        self.assertEqual(actual["authorization"], "Bearer safe-probe")
        self.assertEqual(actual["forwarded_for"], "127.0.0.1")
        self.assertEqual(actual["forwarded_proto"], "http")
        self.assertIsNone(actual["forwarded"])
        self.assertEqual(actual["accept_encoding"], "identity")
        connection.close()

    def test_static_symlink_cannot_escape_dist_root(self):
        link = self.dist / "assets" / "outside-link.txt"
        if not link.is_symlink():
            self.skipTest("symlinks unavailable")
        connection, response = self.request("GET", "/assets/outside-link.txt")
        body = response.read().decode(errors="replace")
        connection.close()
        self.assertNotIn("OUTSIDE_SENTINEL_MUST_NEVER_BE_SERVED", body)
        connection, response = self.request("HEAD", "/assets/outside-link.txt")
        self.assertEqual(response.status, 200)
        self.assertNotIn("OUTSIDE_SENTINEL_MUST_NEVER_BE_SERVED", response.read().decode(errors="replace"))
        connection.close()

    def test_client_disconnect_releases_upstream_stream(self):
        connection, response = self.request("GET", "/api/long-stream")
        self.assertEqual(response.status, 200)
        first = response.read1(4096)
        self.assertTrue(first)
        response.close()
        connection.close()
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            with self.state.lock:
                active = self.state.active_streams
            if active == 0:
                break
            time.sleep(0.05)
        self.assertEqual(active, 0, "closing the downstream client should close the upstream response")

    def test_upstream_abort_does_not_emit_clean_chunked_termination(self):
        connection, response = self.request("GET", "/api/upstream-abort")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.read1(4096), b"data: partial\n\n")
        with self.assertRaises((http.client.IncompleteRead, http.client.RemoteDisconnected, OSError)):
            response.read()
        response.close()
        connection.close()

    def test_chunked_request_body_is_rejected_instead_of_misframed(self):
        with socket.create_connection(("127.0.0.1", self.proxy_port), timeout=3) as sock:
            sock.sendall(
                b"POST /api/echo HTTP/1.1\r\nHost: localhost\r\n"
                b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                b"4\r\ntest\r\n0\r\n\r\n"
            )
            status = sock.makefile("rb").readline().decode("ascii").strip()
        self.assertIn(" 501 ", status)

    def test_relative_dist_uses_launch_directory_and_default_dist_uses_script_directory(self):
        relative_dist = self.root / "relative-dist"
        relative_dist.mkdir()
        (relative_dist / "index.html").write_text("relative-dist-sentinel")
        process, port = self.start_aux_proxy(
            script=SCRIPT, cwd=self.root, dist_value="relative-dist",
        )
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("GET", "/")
            response = connection.getresponse()
            self.assertIn("relative-dist-sentinel", response.read().decode())
            connection.close()
        finally:
            process.terminate()
            process.wait(timeout=3)
            if process.stderr:
                process.stderr.close()

        project = self.root / "relocated" / "frontend"
        (project / "dist").mkdir(parents=True)
        (project / "dist" / "index.html").write_text("script-relative-default-sentinel")
        copied_script = project / "serve-dist-linux.py"
        copied_script.write_bytes(SCRIPT.read_bytes())
        unrelated_cwd = self.root / "unrelated-cwd"
        unrelated_cwd.mkdir()
        process, port = self.start_aux_proxy(
            script=copied_script, cwd=unrelated_cwd, dist_value="",
        )
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request("GET", "/")
            response = connection.getresponse()
            self.assertIn("script-relative-default-sentinel", response.read().decode())
            connection.close()
        finally:
            process.terminate()
            process.wait(timeout=3)
            if process.stderr:
                process.stderr.close()

    def test_invalid_environment_is_rejected_without_echoing_backend_url(self):
        env = os.environ.copy()
        env.update({
            "DAP_FRONTEND_DIST": str(self.dist),
            "DAP_BACKEND_URL": "not-a-valid-url",
            "DAP_HOST": "127.0.0.1",
            "DAP_PORT": "15198",
        })
        process = subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=str(self.root), env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3, check=False,
        )
        diagnostic = process.stderr.decode(errors="replace")
        self.assertEqual(process.returncode, 2)
        self.assertIn("invalid configuration", diagnostic)
        self.assertNotIn("not-a-valid-url", diagnostic)

    def test_upstream_connection_refusal_returns_generic_gateway_error(self):
        bad_port = free_port()
        bad_env = {"DAP_BACKEND_URL": f"http://127.0.0.1:{bad_port}"}
        old_proxy = self.proxy
        self.proxy = None
        old_proxy.terminate()
        old_proxy.wait(timeout=3)
        if old_proxy.stderr:
            old_proxy.stderr.close()
        self.start_proxy(env_extra=bad_env)
        connection, response = self.request("GET", "/api/json")
        body = response.read().decode(errors="replace")
        connection.close()
        self.assertEqual(response.status, 502)
        self.assertNotIn("127.0.0.1", body, "backend connection details must not be reflected to clients")
        self.assertNotIn(str(bad_port), body)
        # tearDown owns termination/descriptor cleanup for the replacement process.

    def test_options_preflight_remains_available(self):
        connection, response = self.request("OPTIONS", "/api/echo")
        self.assertEqual(response.status, 204)
        self.assertIn("GET", response.getheader("Access-Control-Allow-Methods", ""))
        connection.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
