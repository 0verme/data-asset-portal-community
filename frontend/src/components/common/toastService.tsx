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

import { Icon } from "../ui.tsx";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  duration?: number | undefined;
}

interface ToastPayload {
  message: string;
  tone: ToastTone;
  duration: number;
}

interface ToastItem extends Omit<ToastPayload, "duration"> {
  id: number;
}

const TONE_ICON: Record<ToastTone, string> = {
  success: "check",
  error: "close",
  warning: "info",
  info: "info",
};
const DEFAULT_DURATION = 3200;

let pushToast: ((payload: ToastPayload) => void) | null = null;

function emit(message: unknown, tone: ToastTone, options: ToastOptions = {}): void {
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
  success: (message: unknown, options?: ToastOptions): void => emit(message, "success", options),
  error: (message: unknown, options?: ToastOptions): void => emit(message, "error", options),
  warning: (message: unknown, options?: ToastOptions): void => emit(message, "warning", options),
  info: (message: unknown, options?: ToastOptions): void => emit(message, "info", options),
};

export function ToastHost() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const timersRef = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  React.useEffect(() => {
    const timers = timersRef.current;
    pushToast = ({ message, tone, duration }: ToastPayload) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, message, tone }]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    };
    return () => {
      pushToast = null;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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
