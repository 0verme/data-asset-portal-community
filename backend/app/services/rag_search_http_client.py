"""HTTP client for the dap-rag-lab HTTP Search Service v1 contract.

This module deliberately has no imports from dap-rag-lab and performs no local
model/index loading. Retrieval strategy is selected by the RAG service.
"""

from __future__ import annotations

import json
import threading
from typing import Any

import httpx
from pydantic import ValidationError

from ..contracts.rag_search import (
    RagHttpSearchRequest,
    RagHttpSearchResponse,
    RagSearchConfig,
)

MAX_HTTP_RESPONSE_BYTES = 1_000_000


class RagHttpClientError(RuntimeError):
    """Safe, stable adapter failure without raw URL/body/credential details."""

    def __init__(self, reason_code: str) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code)


class RagSearchHttpClient:
    """Bounded, authenticated HTTP-only client for the RAG Search Service."""

    def __init__(
        self,
        *,
        client: httpx.Client | None = None,
        max_concurrent_requests: int = 4,
    ) -> None:
        self._client = client or httpx.Client(
            follow_redirects=False,
            trust_env=False,
        )
        self._capacity = threading.BoundedSemaphore(max_concurrent_requests)

    @staticmethod
    def _endpoint(config: RagSearchConfig, path: str) -> str:
        return f"{config.service_url.rstrip('/')}{path}"

    @staticmethod
    def _headers(token: str) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        }

    @staticmethod
    def _raise_for_status(status_code: int, content: bytes) -> None:
        if 200 <= status_code < 300:
            return
        code = None
        try:
            body = json.loads(content)
            error = body.get("error") if isinstance(body, dict) else None
            code = error.get("code") if isinstance(error, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            pass
        if code == "SEARCH_TIMEOUT" or status_code in (408, 504):
            raise RagHttpClientError("timeout")
        if code == "UNAUTHORIZED" or status_code in (401, 403):
            raise RagHttpClientError("service_unauthorized")
        if code == "INDEX_NOT_READY":
            raise RagHttpClientError("index_not_ready")
        if code == "MODEL_MISMATCH":
            raise RagHttpClientError("model_mismatch")
        if code == "SERVICE_BUSY":
            raise RagHttpClientError("busy")
        if code == "INVALID_REQUEST":
            raise RagHttpClientError("invalid_response")
        if status_code >= 500:
            raise RagHttpClientError("service_unavailable")
        raise RagHttpClientError("invalid_response")

    @staticmethod
    def _decode_json(content: bytes) -> dict[str, Any]:
        try:
            body = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            raise RagHttpClientError("invalid_response") from None
        if not isinstance(body, dict):
            raise RagHttpClientError("invalid_response")
        return body

    def _request(
        self,
        method: str,
        url: str,
        *,
        token: str,
        timeout_ms: int,
        json_body: dict[str, Any] | None = None,
    ) -> bytes:
        if not token:
            raise RagHttpClientError("service_unavailable")
        if not self._capacity.acquire(blocking=False):
            raise RagHttpClientError("busy")
        response: httpx.Response | None = None
        try:
            try:
                request = self._client.build_request(
                    method,
                    url,
                    headers=self._headers(token),
                    json=json_body,
                    timeout=max(0.001, timeout_ms / 1000),
                )
                response = self._client.send(
                    request,
                    stream=True,
                    follow_redirects=False,
                )
                chunks = bytearray()
                for chunk in response.iter_bytes():
                    if len(chunks) + len(chunk) > MAX_HTTP_RESPONSE_BYTES:
                        raise RagHttpClientError("invalid_response")
                    chunks.extend(chunk)
            except httpx.TimeoutException:
                raise RagHttpClientError("timeout") from None
            except httpx.HTTPError:
                raise RagHttpClientError("service_unavailable") from None
            content = bytes(chunks)
            self._raise_for_status(response.status_code, content)
            return content
        finally:
            if response is not None:
                response.close()
            self._capacity.release()

    def search(
        self,
        config: RagSearchConfig,
        *,
        token: str,
        query: str,
    ) -> RagHttpSearchResponse:
        try:
            request = RagHttpSearchRequest(
                query=query,
                topK=config.top_k,
            )
        except ValidationError:
            raise RagHttpClientError("invalid_response") from None
        content = self._request(
            "POST",
            self._endpoint(config, "/api/v1/search"),
            token=token,
            timeout_ms=config.timeout_ms,
            json_body=request.model_dump(by_alias=True),
        )
        body = self._decode_json(content)
        try:
            return RagHttpSearchResponse.model_validate(body)
        except ValidationError:
            raise RagHttpClientError("invalid_response") from None

    def diagnostics(
        self,
        config: RagSearchConfig,
        *,
        token: str,
    ) -> dict[str, Any]:
        try:
            self._request(
                "GET",
                self._endpoint(config, "/healthz"),
                token=token,
                timeout_ms=config.timeout_ms,
            )
        except RagHttpClientError as error:
            return {
                "status": "unavailable",
                "reasonCode": error.reason_code,
                "health": "unavailable",
                "ready": False,
            }
        try:
            self._request(
                "GET",
                self._endpoint(config, "/readyz"),
                token=token,
                timeout_ms=config.timeout_ms,
            )
        except RagHttpClientError as error:
            return {
                "status": "unavailable",
                "reasonCode": error.reason_code,
                "health": "ok",
                "ready": False,
            }
        return {
            "status": "ready",
            "reasonCode": None,
            "health": "ok",
            "ready": True,
        }

    def close(self) -> None:
        self._client.close()
