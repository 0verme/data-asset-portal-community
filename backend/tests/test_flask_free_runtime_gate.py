"""F5 isolated native FastAPI runtime gate."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class FlaskFreeRuntimeGateTests(unittest.TestCase):
    def test_native_composition_starts_with_flask_imports_blocked(self):
        probe = textwrap.dedent(
            """
            import builtins
            import os
            import sys

            blocked = {"flask", "flask_cors"}
            real_import = builtins.__import__

            def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
                root = name.split(".", 1)[0]
                if root in blocked:
                    raise AssertionError(f"native runtime imported blocked package: {root}")
                return real_import(name, globals, locals, fromlist, level)

            builtins.__import__ = guarded_import
            os.environ["APP_ENV"] = "development"
            os.environ["APP_SECRET_KEY"] = "x" * 48

            from fastapi.testclient import TestClient
            from backend.app.application import current_request_context
            from backend.app.core.capabilities import resolve_capabilities
            from backend.app.fastapi_app import create_fastapi_app
            from backend.asgi import app as module_app, create_native_app

            capabilities = resolve_capabilities()
            native_app = create_fastapi_app(
                capabilities=capabilities,
                identity_resolver=lambda _request: None,
            )

            @native_app.get("/__flask_free_probe")
            def probe():
                context = current_request_context()
                return {
                    "method": context.method if context else None,
                    "path": context.path if context else None,
                    "flaskImported": any(
                        name == "flask" or name.startswith("flask.")
                        for name in sys.modules
                    ),
                }

            paths = set(native_app.openapi()["paths"])
            required = {
                "/api/auth/login",
                "/api/auth/me",
                "/api/auth/logout",
                "/api/capabilities",
                "/api/portal/stats",
                "/api/search",
            }
            assert required.issubset(paths), (required - paths)
            runtime = create_native_app(
                capabilities=capabilities,
                fastapi_application=native_app,
            )
            module_health = TestClient(module_app).get("/healthz")
            assert module_health.status_code == 200, module_health.text
            assert module_health.json() == {
                "status": "ok",
                "runtime": "fastapi",
                "fastapiPrimary": True,
            }
            response = TestClient(runtime).get("/__flask_free_probe")
            assert response.status_code == 200, response.text
            assert response.json() == {
                "method": "GET",
                "path": "/__flask_free_probe",
                "flaskImported": False,
            }, response.json()
            """
        )
        environment = os.environ.copy()
        pythonpath = [str(BACKEND_ROOT)]
        if environment.get("PYTHONPATH"):
            pythonpath.append(environment["PYTHONPATH"])
        environment["PYTHONPATH"] = os.pathsep.join(pythonpath)
        result = subprocess.run(
            [sys.executable, "-c", probe],
            cwd=BACKEND_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        self.assertEqual(
            0,
            result.returncode,
            msg=f"native gate failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_flask_imports_are_not_top_level_in_application_package(self):
        source = (
            BACKEND_ROOT / "backend" / "app" / "__init__.py"
        ).read_text(encoding="utf-8")
        top_level = "\n".join(
            line for line in source.splitlines() if not line.startswith("    ")
        )
        self.assertNotIn("from flask import", top_level)
        self.assertNotIn("from flask_cors import", top_level)


if __name__ == "__main__":
    unittest.main()
