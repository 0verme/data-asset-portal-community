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

import React from "react";
import { Icon } from "../ui.jsx";

/**
 * 命令式轻量消息提示（Toast）。
 *
 *   toast.success("保存成功");
 *   toast.error("更新用户状态失败。");
 *   toast.info("已复制到剪贴板", { duration: 2000 });
 *
 * 用于替换浏览器原生 window.alert 的「消息通知」场景（成功 / 失败 / 提示），
 * 注意：删除等需要用户确认的场景请使用 confirmDelete / ConfirmDialog。
 *
 * 需在应用根节点挂载一次 <ToastHost />（见 App.jsx）。宿主未挂载时退化为
 * window.alert 以保证消息不丢失。
 */
const TONE_ICON = { success: "check", error: "close", warning: "info", info: "info" };
const DEFAULT_DURATION = 3200;

let pushToast = null;

function emit(message, tone, options = {}) {
  const text = typeof message === "string" ? message : String(message ?? "");
  if (!pushToast) {
    // 兜底：宿主未挂载时退化为原生 alert，保证消息不丢失
    window.alert(text);
    return;
  }
  pushToast({
    message: text,
    tone,
    duration: options.duration ?? DEFAULT_DURATION,
  });
}

export const toast = {
  success: (message, options) => emit(message, "success", options),
  error: (message, options) => emit(message, "error", options),
  warning: (message, options) => emit(message, "warning", options),
  info: (message, options) => emit(message, "info", options),
};

export function ToastHost() {
  const [items, setItems] = React.useState([]);
  const idRef = React.useRef(0);
  const timersRef = React.useRef(new Map());

  const dismiss = React.useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  React.useEffect(() => {
    pushToast = ({ message, tone, duration }) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, message, tone }]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    };
    return () => {
      pushToast = null;
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, [dismiss]);

  if (!items.length) return null;

  return (
    <div className="toast-stack" role="region" aria-label="消息提示">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.tone}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            <Icon name={TONE_ICON[item.tone] || "info"} size={18} />
          </span>
          <div className="toast-message">{item.message}</div>
          <button
            className="toast-close"
            type="button"
            aria-label="关闭"
            onClick={() => dismiss(item.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
