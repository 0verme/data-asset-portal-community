// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  REQUEST_TIMEOUT,
  formatTimeoutLabel,
  resolveRequestTimeout,
  summarizeRequestPayload,
} from "../config/request.js";
import { createInFlightGetRequestGroup } from "./inFlightRequests.js";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const runInFlightGetRequest = createInFlightGetRequestGroup();

export function buildUrl(path, params) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  return `${url.pathname}${url.search}`;
}

export function isUnauthorizedError(error) {
  return Boolean(error && typeof error === "object" && error.status === 401);
}

function resolveNow() {
  return window.performance?.now?.() ?? Date.now();
}

export async function requestRemote(path, options = {}) {
  const timeoutMs = resolveRequestTimeout(options.timeout ?? options.timeoutMs, REQUEST_TIMEOUT);
  const requestUrl = buildUrl(path, options.params);
  const method = String(options.method || "GET").toUpperCase();
  const credentials = options.credentials || "include";

  return runInFlightGetRequest({
    method,
    requestUrl,
    credentials,
    timeoutMs,
    suppressUnauthorizedEvent: options.suppressUnauthorizedEvent,
    signal: options.signal,
    hasBody: options.body !== undefined,
  }, async () => {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const startedAt = resolveNow();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        method,
        credentials,
        headers: {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (typeof payload === "string") {
        const trimmed = payload.trim();
        const looksLikeHtml = contentType.includes("text/html")
          || /^<!doctype html/i.test(trimmed)
          || /^<html[\s>]/i.test(trimmed);

        if (looksLikeHtml) {
          throw new Error(
            "\u63a5\u53e3\u8fd4\u56de\u7684\u662f HTML \u9875\u9762\u800c\u4e0d\u662f JSON\uff0c"
            + "\u8bf7\u68c0\u67e5 Vite /api \u4ee3\u7406\u6216\u540e\u7aef\u670d\u52a1\u662f\u5426\u5df2\u542f\u52a8\u3002",
          );
        }
      }

      if (!response.ok) {
        const error = new Error(
          payload?.error?.message
            || payload?.message
            || `\u8bf7\u6c42\u5931\u8d25: ${response.status} ${response.statusText}`,
        );
        error.status = response.status;
        error.payload = payload;
        if (response.status === 401 && !options.suppressUnauthorizedEvent) {
          window.dispatchEvent(new CustomEvent("app:unauthorized"));
        }
        throw error;
      }

      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (!timedOut) {
          error.name = "AbortError";
          throw error;
        }
        const durationMs = Math.round(resolveNow() - startedAt);
        console.warn("[request-timeout]", {
          method,
          url: requestUrl,
          timeoutMs,
          durationMs,
          params: summarizeRequestPayload(options.params),
          body: summarizeRequestPayload(options.body),
        });
        throw new Error(
          `\u63a5\u53e3\u8bf7\u6c42\u8d85\u65f6\uff08${formatTimeoutLabel(timeoutMs)}\uff09\uff0c`
          + "\u53ef\u80fd\u662f\u67e5\u8be2\u6570\u636e\u91cf\u8f83\u5927\u6216\u540e\u7aef\u5904\u7406\u8f83\u6162\uff0c"
          + "\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  });
}
