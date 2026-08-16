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

const THEME_STORAGE_KEY = "dap-theme";

export { THEME_STORAGE_KEY };

export function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return "light";
}

export function scrollMainToTop() {
  window.scrollTo(0, 0);
  const main = document.querySelector(".main");
  if (main) main.scrollTop = 0;
}

export function optionLabel(option) {
  if (typeof option === "string") return option;
  return option?.name || option?.value || "";
}

export function getErrorMessage(error, fallback = "操作失败，请稍后重试。") {
  const details = error?.payload?.error?.details;
  if (Array.isArray(details)) {
    const messages = details
      .map((detail) => {
        if (typeof detail === "string") return detail.trim();
        if (!detail || typeof detail.message !== "string") return "";
        const message = detail.message.trim();
        const field = typeof detail.field === "string" ? detail.field.trim() : "";
        return field && message ? `${field}：${message}` : message;
      })
      .filter(Boolean);
    if (messages.length) return [...new Set(messages)].join("；");
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
