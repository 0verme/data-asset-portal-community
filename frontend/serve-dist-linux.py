# -*- coding: utf-8 -*-
"""
Frontend static + API proxy server for Linux DAP deployment.
Serves the prebuilt frontend `dist/` and proxies /api/** to the Linux backend.
Uses only the Python standard library (no external deps).

Environment variables (all optional):
    DAP_FRONTEND_DIST  - built frontend dist dir; relative values use launch cwd.
                         Default: `dist/` next to this script, independent of cwd.
    DAP_BACKEND_URL    - backend HTTP(S) origin (default http://127.0.0.1:15099)
    DAP_HOST           - bind address (default 0.0.0.0)
    DAP_PORT           - TCP port 1-65535 (default 15198)
"""
import http.server
import urllib.request
import urllib.error
import urllib.parse
import email.utils
import os
import select
import shutil
import socket
import sys
import threading


def _resolve_dist():
    configured = os.environ.get("DAP_FRONTEND_DIST")
    if configured is None or not configured.strip():
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
    else:
        path = os.path.expanduser(configured.strip())
        if not os.path.isabs(path):
            # Explicit relative paths are relative to the process launch cwd.
            path = os.path.join(os.getcwd(), path)
    return os.path.abspath(path)


DIST = _resolve_dist()
BACKEND = os.environ.get("DAP_BACKEND_URL", "http://127.0.0.1:15099")

# Streamed (SSE) responses must not be buffered into a single payload. They are
# forwarded chunk-by-chunk with flush() so the browser sees each event as the
# upstream produces it. Block size for streaming reads in bytes.
_STREAM_CHUNK_SIZE = 65536
# How often the downstream watchdog rechecks the client socket while an SSE
# stream is open. This only bounds disconnect detection latency; it never gates
# forwarding of upstream data.
_CLIENT_POLL_INTERVAL = 0.25
# Preserve the existing buffered API timeout.
_NON_STREAM_TIMEOUT = 120
# Bound SSE memory/network use; on overflow the response is aborted, not marked
# as a cleanly completed event stream.
_MAX_STREAM_TOTAL = 64 * 1024 * 1024

_HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
}
_UNTRUSTED_FORWARD_HEADERS = {
    "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
    "x-forwarded-port", "x-forwarded-prefix", "x-real-ip",
}
_RESPONSE_HEADERS = (
    "Content-Type", "Content-Encoding", "Content-Language", "Content-Disposition",
    "Cache-Control", "ETag", "Last-Modified", "Expires", "Vary", "Location",
    "Retry-After", "WWW-Authenticate",
)
# Directory index candidates, matching http.server.SimpleHTTPRequestHandler.
_DIRECTORY_INDEX_FILES = ("index.html", "index.htm")


def _normalize_backend_url(value):
    """Accept only an HTTP(S) origin, preventing accidental credential/URL leakage."""
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        # Accessing .port validates malformed port syntax.
        parsed.port
    except (AttributeError, ValueError):
        raise ValueError("DAP_BACKEND_URL must be a valid HTTP(S) origin") from None
    if (
        parsed.scheme.lower() not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or any(char.isspace() for char in value)
    ):
        raise ValueError("DAP_BACKEND_URL must be a valid HTTP(S) origin without credentials or path")
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc, "", "", ""))


def _is_proxy_path(path):
    clean = urllib.parse.urlsplit(path).path
    return (
        clean == "/api" or clean.startswith("/api/")
        or clean == "/healthz"
        or clean == "/docs" or clean.startswith("/docs/")
        or clean == "/openapi.json"
    )


def _upstream_socket(resp):
    """Best-effort access to the raw upstream socket behind urllib's reader.

    Works for both ``HTTPResponse`` and ``HTTPError`` (whose body lives on
    ``.fp``). Returns ``None`` when the socket cannot be located, in which case
    streaming still works but a downstream disconnect is only noticed on the
    next write.
    """
    for candidate in (resp, getattr(resp, "fp", None)):
        if candidate is None:
            continue
        raw = getattr(candidate, "raw", None) or candidate
        sock = getattr(raw, "_sock", None)
        if sock is not None:
            return sock
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Return redirects to the caller instead of following them with credentials."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_UPSTREAM_OPENER = urllib.request.build_opener(_NoRedirect())


class Handler(http.server.SimpleHTTPRequestHandler):
    # Enable HTTP/1.1 so we can emit a proper chunked transfer encoding for
    # streamed (SSE) responses. Static files and JSON all set an explicit
    # Content-Length, so this does not change their behaviour.
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[frontend %s] %s\n" % (self.client_address[0], fmt % args))

    def log_request(self, code="-", size="-"):
        # Do not persist query strings, which may contain user-supplied secrets.
        path = urllib.parse.urlsplit(self.path).path
        safe_path = urllib.parse.quote(path, safe="/%:@-._~")
        sys.stderr.write("[frontend %s] %s %s %s\n" % (
            self.client_address[0], self.command, safe_path, code,
        ))

    def _forward_headers(self, status, headers, data, head_only=False):
        self.send_response(status)
        content_type = headers.get("Content-Type")
        if content_type:
            self.send_header("Content-Type", content_type)
        else:
            self.send_header("Content-Type", "application/octet-stream")
        for name in _RESPONSE_HEADERS:
            # Forward upstream Cache-Control verbatim: buffered API responses
            # (e.g. authenticated snapshot pages) rely on no-store reaching the
            # browser. Only the SSE path overrides it.
            if name.lower() == "content-type":
                continue
            for value in headers.get_all(name) or []:
                self.send_header(name, value)
        if status not in (204, 304) and not 100 <= status < 200:
            upstream_length = headers.get("Content-Length") if head_only else None
            self.send_header("Content-Length", upstream_length or str(len(data)))
        # Preserve every cookie value (including multiple Set-Cookie headers).
        for value in headers.get_all("Set-Cookie") or []:
            self.send_header("Set-Cookie", value)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    @staticmethod
    def _is_sse(headers):
        content_type = (headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        return content_type == "text/event-stream"

    def _forward_stream_headers(self, status, headers):
        """Begin an HTTP/1.1 chunked SSE response without a total length."""
        # This response cannot be reused for another request on this connection.
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", headers.get("Content-Type", "text/event-stream"))
        for name in _RESPONSE_HEADERS:
            # Cache-Control is set below: a streamed response must never be
            # cached or buffered by an intermediary, whatever upstream said.
            if name.lower() in ("content-type", "cache-control"):
                continue
            for value in headers.get_all(name) or []:
                self.send_header(name, value)
        # Prevent intermediary/browser buffering and state our chunked framing.
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.send_header("Transfer-Encoding", "chunked")
        for value in headers.get_all("Set-Cookie") or []:
            self.send_header("Set-Cookie", value)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _write_stream_chunk(self, data):
        """Write a single HTTP/1.1 chunk (size line + data + CRLF) and flush.

        The explicit flush is what makes each event reach the client socket
        immediately rather than being buffered until the stream ends.
        """
        self.wfile.write(("%x\r\n" % len(data)).encode("ascii"))
        self.wfile.write(data)
        self.wfile.write(b"\r\n")
        self.wfile.flush()

    def _stream_upstream(self, resp):
        """Pull upstream body incrementally and forward each read as an HTTP chunk.

        urllib's ``HTTPResponse`` is a ``BufferedReader``; calling ``read(n)`` with
        a large ``n`` blocks until it has collected ``n`` bytes or EOF, so a small
        SSE body would be buffered to completion. We therefore use ``read1(n)``,
        which returns at most one underlying socket read, preserving incremental
        delivery.

        ``read1`` is called unconditionally. Gating it on raw-socket readiness
        (``select``) is wrong: when upstream writes headers and events in a
        single segment, the reader already holds those body bytes while the
        socket has nothing left to report, so a ``select`` gate delays every
        buffered event until upstream writes again or closes.

        Disconnect detection therefore moved to a watchdog thread that peeks the
        client socket and shuts the upstream read side down on disconnect. That
        wakes the blocking ``read1`` without ever bounding it by a socket
        timeout: a timed-out ``BufferedReader`` cannot be read from again.
        Returns total bytes copied.
        """
        upstream_socket = _upstream_socket(resp)
        stop = threading.Event()
        watchdog = None
        if upstream_socket is not None:
            watchdog = threading.Thread(
                target=self._watch_downstream,
                args=(stop, upstream_socket),
                daemon=True,
            )
            watchdog.start()

        total = 0
        try:
            while True:
                chunk = resp.read1(_STREAM_CHUNK_SIZE) if hasattr(resp, "read1") else resp.read(_STREAM_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_STREAM_TOTAL:
                    # Abort the framing: a zero chunk would falsely signal success.
                    self.close_connection = True
                    return total
                self._write_stream_chunk(chunk)
            # Only a clean upstream EOF gets the terminal HTTP chunk; an aborted
            # stream returns early above and leaves the body unterminated.
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        finally:
            stop.set()
            if watchdog is not None:
                watchdog.join(timeout=2)
            try:
                resp.close()
            except Exception:
                pass
        return total

    def _watch_downstream(self, stop, upstream_socket):
        """Cancel the upstream read as soon as the browser goes away.

        Shutting the upstream socket down (rather than closing the response)
        unblocks the in-flight ``read1`` without corrupting the reader state.
        """
        while not stop.wait(_CLIENT_POLL_INTERVAL):
            if not self._client_disconnected():
                continue
            try:
                upstream_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                # Already closed; the pending read has nothing left to wait for.
                pass

    def _client_disconnected(self):
        """Return True if the browser has closed the connection.

        A zero-timeout readiness check followed by MSG_PEEK keeps this from
        blocking or consuming client bytes, and never mutates the socket timeout
        that concurrent writes depend on.
        """
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if not readable:
                return False
            # Readable with no data means the peer closed its send direction.
            return self.connection.recv(1, socket.MSG_PEEK) == b""
        except (ConnectionResetError, ConnectionAbortedError):
            return True
        except (OSError, ValueError):
            return True

    def _forward_upstream_error(self, error):
        """Preserve upstream error status/body, streaming SSE errors if present."""
        try:
            if self._is_sse(error.headers) and error.fp is not None:
                self._forward_stream_headers(error.code, error.headers)
                try:
                    self._stream_upstream(error)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    self.close_connection = True
                except Exception:
                    self.close_connection = True
                return
            data = error.read()
            self._forward_headers(error.code, error.headers, data, head_only=self.command == "HEAD")
            if self.command != "HEAD":
                self.wfile.write(data)
        finally:
            error.close()

    def _proxy(self):
        path = self.path
        target = BACKEND + path

        # BaseHTTPRequestHandler does not decode chunked request bodies. Reject
        # them and close rather than forwarding a partial or ambiguous request.
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            self.send_error(501, "chunked request bodies are not supported")
            return
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) > 1:
            self.close_connection = True
            self.send_error(400, "invalid request body length")
            return
        try:
            length = int(lengths[0]) if lengths else 0
            if length < 0:
                raise ValueError
        except ValueError:
            self.close_connection = True
            self.send_error(400, "invalid request body length")
            return

        body = None
        if length:
            body = self.rfile.read(length)
            if len(body) != length:
                self.close_connection = True
                self.send_error(400, "incomplete request body")
                return
        elif self.command in ("POST", "PUT", "PATCH", "DELETE"):
            body = b""

        connection_tokens = {
            token.strip().lower()
            for value in (self.headers.get_all("Connection") or [])
            for token in value.split(",")
            if token.strip()
        }
        headers = {}
        for name, value in self.headers.items():
            lower = name.lower()
            if (
                lower in _HOP_BY_HOP_HEADERS or lower in _UNTRUSTED_FORWARD_HEADERS
                or lower == "host" or lower == "content-length" or lower in connection_tokens
            ):
                continue
            headers[name] = value
        # The proxy is the trusted network hop; never trust client-supplied
        # forwarding metadata when the backend enables proxy-header handling.
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["X-Forwarded-Proto"] = "http"
        # Keep SSE intermediaries from buffering a compressed response; the
        # response headers are still forwarded if the backend ignores this hint.
        headers["Accept-Encoding"] = "identity"

        req = urllib.request.Request(target, data=body, method=self.command, headers=headers)
        try:
            resp = _UPSTREAM_OPENER.open(req, timeout=_NON_STREAM_TIMEOUT)
        except urllib.error.HTTPError as error:
            self._forward_upstream_error(error)
            return
        except Exception:
            # Do not echo backend URLs, resolver details, or credentials to clients.
            self.send_error(502, "proxy error")
            return

        try:
            if self._is_sse(resp.headers):
                try:
                    self._forward_stream_headers(resp.status, resp.headers)
                    self._stream_upstream(resp)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    self.close_connection = True
                except Exception:
                    # The framed body is intentionally left incomplete on failure.
                    self.close_connection = True
            else:
                data = resp.read()
                self._forward_headers(resp.status, resp.headers, data, head_only=self.command == "HEAD")
                if self.command != "HEAD":
                    self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        finally:
            try:
                resp.close()
            except Exception:
                pass

    def _reject_unexpected_body(self):
        """Static and preflight routes do not accept request bodies."""
        lengths = self.headers.get_all("Content-Length") or []
        has_body = bool(self.headers.get_all("Transfer-Encoding")) or len(lengths) > 1
        if lengths and not has_body:
            try:
                has_body = int(lengths[0]) != 0
            except ValueError:
                has_body = True
        if has_body:
            self.close_connection = True
            self.send_error(400, "request body is not supported on this route")
            return True
        return False

    def _contained_path(self, path):
        """Return ``path`` resolved if it stays inside dist, otherwise ``None``.

        ``realpath`` expands every symlink component, so a link inside dist that
        points outside is rejected here rather than by a later consumer.
        """
        root = os.path.realpath(DIST)
        candidate = os.path.realpath(path)
        try:
            if os.path.commonpath((root, candidate)) != root:
                return None
        except (OSError, ValueError):
            return None
        return candidate

    def _resolve_static_target(self):
        """Resolve the exact file that will be served, directory index included.

        Validation must describe the file that is actually read. Delegating a
        directory request to SimpleHTTPRequestHandler after only checking
        ``/index.html`` let it resolve ``<dir>/index.html`` on its own, so a
        symlinked index under dist was served from outside dist.
        """
        candidate = self._contained_path(super().translate_path(self.path))
        if candidate is None:
            return None
        if not os.path.isdir(candidate):
            return candidate if os.path.isfile(candidate) else None
        for name in _DIRECTORY_INDEX_FILES:
            index_path = self._contained_path(os.path.join(candidate, name))
            if index_path is not None and os.path.isfile(index_path):
                return index_path
        return None

    def _redirect_directory_without_slash(self):
        """Match SimpleHTTPRequestHandler: a directory URL needs its trailing slash.

        Without it, relative asset URLs inside a served index resolve against the
        parent directory instead of the directory being served.
        """
        parts = urllib.parse.urlsplit(self.path)
        if parts.path.endswith("/"):
            return False
        directory = self._contained_path(super().translate_path(self.path))
        if directory is None or not os.path.isdir(directory):
            return False
        self.send_response(301)
        self.send_header(
            "Location",
            urllib.parse.urlunsplit((parts[0], parts[1], parts[2] + "/", parts[3], parts[4])),
        )
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def _serve_static_or_spa(self, head_only=False):
        if self._redirect_directory_without_slash():
            return
        target = self._resolve_static_target()
        if target is None:
            # The SPA fallback goes through the same containment check.
            target = self._contained_path(os.path.join(DIST, "index.html"))
        if target is None or not os.path.isfile(target):
            self.send_error(404, "not found")
            return
        self._send_static_file(target, head_only)

    def _send_static_file(self, path, head_only):
        """Serve one already-validated file, so validation and delivery agree."""
        try:
            handle = open(path, "rb")
        except OSError:
            self.send_error(404, "not found")
            return
        with handle:
            stat = os.fstat(handle.fileno())
            last_modified = self.date_time_string(stat.st_mtime)
            if self._not_modified_since(stat.st_mtime):
                self.send_response(304)
                self.send_header("Last-Modified", last_modified)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", self._content_type_for(path))
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Last-Modified", last_modified)
            self.end_headers()
            if head_only:
                return
            try:
                shutil.copyfileobj(handle, self.wfile)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.close_connection = True

    def _content_type_for(self, path):
        content_type = self.guess_type(path)
        if content_type.startswith("text/") and "charset=" not in content_type:
            content_type += "; charset=utf-8"
        return content_type

    def _not_modified_since(self, mtime):
        """Honour If-Modified-Since so static assets keep their 304 behaviour."""
        value = self.headers.get("If-Modified-Since")
        if not value:
            return False
        parsed = email.utils.parsedate_tz(value)
        if parsed is None:
            return False
        try:
            return int(mtime) <= int(email.utils.mktime_tz(parsed))
        except (OSError, OverflowError, ValueError):
            return False

    def do_GET(self):
        if _is_proxy_path(self.path):
            self._proxy()
        elif not self._reject_unexpected_body():
            self._serve_static_or_spa()

    def do_HEAD(self):
        if _is_proxy_path(self.path):
            self._proxy()
        elif not self._reject_unexpected_body():
            self._serve_static_or_spa(head_only=True)

    def do_POST(self):
        if _is_proxy_path(self.path):
            self._proxy()
        else:
            self.send_error(405)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def do_OPTIONS(self):
        if self._reject_unexpected_body():
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()


def main():
    global BACKEND
    host = os.environ.get("DAP_HOST", "0.0.0.0").strip()
    if not host:
        print("[frontend] DAP_HOST must not be empty", file=sys.stderr)
        return 2
    try:
        port = int(os.environ.get("DAP_PORT", "15198"))
        if not 1 <= port <= 65535:
            raise ValueError
        backend_value = os.environ.get("DAP_BACKEND_URL") or "http://127.0.0.1:15099"
        BACKEND = _normalize_backend_url(backend_value)
    except ValueError as error:
        print("[frontend] invalid configuration: %s" % error, file=sys.stderr)
        return 2
    if not os.path.isdir(DIST):
        print("[frontend] configured frontend dist directory is missing", file=sys.stderr)
        return 1
    try:
        server = http.server.ThreadingHTTPServer((host, port), Handler)
    except (OSError, ValueError):
        print("[frontend] unable to bind configured host and port", file=sys.stderr)
        return 2
    server.daemon_threads = True
    server.block_on_close = False
    print("[frontend] serving configured static files and API proxy")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
