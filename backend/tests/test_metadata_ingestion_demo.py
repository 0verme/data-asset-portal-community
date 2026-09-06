from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from backend.app.contracts.metadata_ingestion import (  # type: ignore
    AssetMetadataIngestionRequest,
)

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "examples" / "metadata_ingestion" / "ingest_assets.py"
SPEC = importlib.util.spec_from_file_location("metadata_ingestion_demo", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"Unable to load metadata ingestion demo: {MODULE_PATH}")
DEMO = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DEMO
SPEC.loader.exec_module(DEMO)

EXAMPLE_PATH = ROOT / "examples" / "metadata_ingestion" / "assets.example.json"
DAP_URL = "http://127.0.0.1:15099"


class FakeHeaders:
    def __init__(self, cookies: list[str] | None = None):
        self.cookies = cookies or []

    def get_all(self, name: str):
        return self.cookies if name.casefold() == "set-cookie" else []

    def get(self, name: str, default=None):
        return self.cookies[0] if name.casefold() == "set-cookie" and self.cookies else default


class FakeResponse:
    def __init__(self, status: int, body: str, cookies: list[str] | None = None):
        self.status = status
        self._body = body.encode("utf-8")
        self.headers = FakeHeaders(cookies)

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def http_error(status: int, body: str = "") -> HTTPError:
    return HTTPError(
        "http://127.0.0.1:15099",
        status,
        "error",
        {},
        io.BytesIO(body.encode("utf-8")),
    )


class MetadataIngestionDemoTests(unittest.TestCase):
    def setUp(self):
        self.payload = DEMO.load_payload(EXAMPLE_PATH)

    def test_example_json_matches_current_metadata_contract(self):
        request = AssetMetadataIngestionRequest.model_validate(self.payload)
        self.assertEqual("1.0", request.contract_version)
        self.assertEqual(3, len(request.assets))
        self.assertEqual(12, sum(len(asset.fields) for asset in request.assets))
        self.assertEqual(
            {"customer_info", "account_info", "customer_asset_summary"},
            {asset.name for asset in request.assets},
        )

    def test_invalid_json_is_reported_as_a_read_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text('{"assets": [}', encoding="utf-8")
            with self.assertRaisesRegex(DEMO.DemoError, "JSON 解析失败"):
                DEMO.load_payload(path)

    def test_contract_validation_failure_is_reported_before_http(self):
        invalid = copy.deepcopy(self.payload)
        del invalid["assets"][0]["fields"][0]["dataType"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid-contract.json"
            path.write_text(json.dumps(invalid), encoding="utf-8")
            stderr = io.StringIO()
            with patch.object(DEMO, "urlopen") as urlopen, redirect_stderr(stderr):
                result = DEMO.main(
                    ["--file", str(path), "--dap-url", DAP_URL, "sync"]
                )
        self.assertEqual(1, result)
        self.assertIn("Contract 校验失败", stderr.getvalue())
        urlopen.assert_not_called()

    def test_preview_only_reads_and_validates_without_http_or_auth(self):
        stdout = io.StringIO()
        with (
            patch.object(DEMO, "urlopen") as urlopen,
            patch.dict(os.environ, {"DAP_PASSWORD": "preview-secret"}, clear=True),
            redirect_stdout(stdout),
        ):
            result = DEMO.main(
                ["--file", str(EXAMPLE_PATH), "--dap-url", DAP_URL, "preview"]
            )
        self.assertEqual(0, result)
        self.assertIn("未发送 HTTP 请求", stdout.getvalue())
        self.assertIn("customer_info", stdout.getvalue())
        self.assertNotIn("preview-secret", stdout.getvalue())
        urlopen.assert_not_called()

    def test_sync_posts_the_contract_with_an_existing_session(self):
        response = FakeResponse(
            201,
            '{"ingestionId":"ingestion-1","status":"completed",'
            '"summary":{"received":3,"create":3}}',
        )
        stdout = io.StringIO()
        with (
            patch.object(DEMO, "urlopen", return_value=response) as urlopen,
            patch.dict(os.environ, {"DAP_SESSION": "signed-session"}, clear=True),
            redirect_stdout(stdout),
        ):
            result = DEMO.main(
                ["--file", str(EXAMPLE_PATH), "--dap-url", DAP_URL, "sync"]
            )
        self.assertEqual(0, result)
        self.assertEqual(1, urlopen.call_count)
        request = urlopen.call_args.args[0]
        self.assertEqual(
            f"{DAP_URL}/api/metadata/assets/ingestions", request.full_url
        )
        self.assertEqual("POST", request.method)
        self.assertEqual("session=signed-session", request.get_header("Cookie"))
        self.assertEqual(self.payload, json.loads(request.data))
        self.assertIn("HTTP 201", stdout.getvalue())
        self.assertIn("Ingestion ID: ingestion-1", stdout.getvalue())
        self.assertNotIn("signed-session", stdout.getvalue())

    def test_sync_logs_in_with_environment_credentials_and_uses_session_cookie(self):
        login_response = FakeResponse(
            200,
            '{"message":"登录成功"}',
            ["session=returned-session; Path=/; HttpOnly"],
        )
        sync_response = FakeResponse(
            201,
            '{"status":"completed","summary":{"received":3}}',
        )
        stdout = io.StringIO()
        with (
            patch.object(
                DEMO,
                "urlopen",
                side_effect=[login_response, sync_response],
            ) as urlopen,
            patch.dict(
                os.environ,
                {"DAP_USERNAME": "demo-user", "DAP_PASSWORD": "demo-password"},
                clear=True,
            ),
            redirect_stdout(stdout),
        ):
            result = DEMO.main(
                ["--file", str(EXAMPLE_PATH), "--dap-url", DAP_URL, "sync"]
            )
        self.assertEqual(0, result)
        self.assertEqual(2, urlopen.call_count)
        login_request = urlopen.call_args_list[0].args[0]
        self.assertEqual(f"{DAP_URL}/api/auth/login", login_request.full_url)
        self.assertEqual(
            {"username": "demo-user", "password": "demo-password"},
            json.loads(login_request.data),
        )
        sync_request = urlopen.call_args_list[1].args[0]
        self.assertEqual("session=returned-session", sync_request.get_header("Cookie"))
        self.assertNotIn("demo-password", stdout.getvalue())
        self.assertNotIn("returned-session", stdout.getvalue())

    def test_http_4xx_is_reported_without_leaking_session(self):
        error = http_error(
            422,
            '{"error":{"code":"INVALID_CONTRACT","message":"invalid contract"}}',
        )
        with patch.object(DEMO, "urlopen", side_effect=error), self.assertRaises(
            DEMO.DemoError
        ) as raised:
            DEMO.post_assets(
                DAP_URL,
                self.payload,
                session_cookie="signed-session",
            )
        self.assertIn("HTTP 422", str(raised.exception))
        self.assertIn("invalid contract", str(raised.exception))
        self.assertNotIn("signed-session", str(raised.exception))

    def test_http_5xx_is_reported_with_server_message(self):
        error = http_error(
            503,
            '{"error":{"code":"TEMPORARY_FAILURE","message":"try later"}}',
        )
        with patch.object(DEMO, "urlopen", side_effect=error), self.assertRaises(
            DEMO.DemoError
        ) as raised:
            DEMO.post_assets(DAP_URL, self.payload, session_cookie="session-value")
        self.assertIn("HTTP 503", str(raised.exception))
        self.assertIn("try later", str(raised.exception))

    def test_unreachable_dap_is_reported_as_transport_error(self):
        with (
            patch.object(DEMO, "urlopen", side_effect=URLError("connection refused")),
            self.assertRaisesRegex(DEMO.DemoError, "DAP Metadata API 不可达"),
        ):
            DEMO.post_assets(DAP_URL, self.payload, session_cookie="session-value")

    def test_login_error_redacts_password_from_server_message(self):
        error = http_error(
            401,
            '{"error":{"message":"password=demo-password"}}',
        )
        with patch.object(DEMO, "urlopen", side_effect=error), self.assertRaises(
            DEMO.DemoError
        ) as raised:
            DEMO._login(
                DAP_URL,
                "demo-user",
                "demo-password",
                timeout=1,
            )
        self.assertIn("HTTP 401", str(raised.exception))
        self.assertNotIn("demo-password", str(raised.exception))

    def test_base_url_is_normalized_to_the_canonical_ingestion_endpoint(self):
        response = FakeResponse(201, '{"status":"completed"}')
        with patch.object(DEMO, "urlopen", return_value=response) as urlopen:
            status, _body = DEMO.post_assets(
                f"{DAP_URL}/",
                self.payload,
                session_cookie="session-value",
            )
        self.assertEqual(201, status)
        request = urlopen.call_args.args[0]
        self.assertEqual(
            f"{DAP_URL}/api/metadata/assets/ingestions", request.full_url
        )

    def test_unchanged_result_is_forwarded_from_existing_api_semantics(self):
        response = FakeResponse(
            201,
            '{"status":"completed","summary":{"received":3,"unchanged":3}}',
        )
        stdout = io.StringIO()
        with (
            patch.object(DEMO, "urlopen", return_value=response),
            patch.dict(os.environ, {"DAP_SESSION": "signed-session"}, clear=True),
            redirect_stdout(stdout),
        ):
            result = DEMO.main(
                ["--file", str(EXAMPLE_PATH), "--dap-url", DAP_URL, "sync"]
            )
        self.assertEqual(0, result)
        self.assertIn('"unchanged": 3', stdout.getvalue())



if __name__ == "__main__":
    unittest.main()
