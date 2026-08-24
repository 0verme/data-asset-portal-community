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

/* ===== 共享 UI 组件与工具 ===== */
import { DOMAIN_HUE_MAP } from "../config/assets.js";

// ---- 图标 (inline SVG, 1.6px stroke) ----
export function Icon({ name, size = 16, color = "currentColor", strokeWidth = 1.7 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
    close: <><path d="M18 6 6 18M6 6l12 12" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></>,
    columns: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    code: <><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    check: <><path d="M20 6 9 17l-5-5" /></>,
    save: <><path d="M5 21h14a1 1 0 0 0 1-1V7.4a1 1 0 0 0-.3-.7l-2.4-2.4a1 1 0 0 0-.7-.3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1Z" /><path d="M8 21v-6h8v6" /><path d="M8 3v5h8" /></>,
    edit: <><path d="M12 20h9" /><path d="m16.5 3.5 4 4L7 21l-4 1 1-4 12.5-14.5Z" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeoff: <><path d="m3 3 18 18" /><path d="M10.6 10.7A3 3 0 0 0 13.3 13.4" /><path d="M9.9 5.1A11.3 11.3 0 0 1 12 5c6.5 0 10 7 10 7a18.3 18.3 0 0 1-4.1 4.9" /><path d="M6.6 6.7C4 8.3 2 12 2 12a18.6 18.6 0 0 0 10 7c1.7 0 3.2-.4 4.5-1" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 8.3-8.3M16 5l3 3M14 7l3 3" /></>,
    hash: <><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>,
    db: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    filter: <><path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" /></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5l3-7Z" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>,
    up: <><path d="m12 5 6 6" /><path d="m12 5-6 6" /><path d="M12 5v14" /></>,
    down: <><path d="m12 19 6-6" /><path d="m12 19-6-6" /><path d="M12 19V5" /></>,
    refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
    push: <><path d="M4 12h10" /><path d="m10 6 6 6-6 6" /><path d="M20 5v14" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 10v6" /><path d="M12 7h.01" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" /></>,
    download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07 6.7 17.3M17.3 6.7l1.77-1.77" /></>,
    moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></>,
    login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
    shield: <><path d="M12 3 5 6v5c0 5 3.4 9.4 7 10 3.6-.6 7-5 7-10V6l-7-3Z" /></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

// ---- 配色: 主题域 → oklch ----
export function domainColors(domain) {
  const h = (DOMAIN_HUE_MAP && DOMAIN_HUE_MAP[domain]) || 260;
  return {
    bg: `oklch(0.62 0.15 ${h} / 0.16)`,
    text: `oklch(0.82 0.12 ${h})`,
    dot: `oklch(0.68 0.16 ${h})`,
    bar: `oklch(0.68 0.16 ${h})`,
  };
}

export function DomainBadge({ domain }) {
  return <span className="tag tag-neutral">{domain}</span>;
}

export function LayerBadge({ layer }) {
  return <span className="badge-layer">{layer}</span>;
}

// 高亮匹配文本
export function Highlight({ text, q }) {
  if (!q) return <>{text}</>;
  const s = String(text);
  const idx = s.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>{s.slice(0, idx)}<mark className="hl">{s.slice(idx, idx + q.length)}</mark>{s.slice(idx + q.length)}</>
  );
}

// 取首字符做头像
export function initial(name) {
  return name ? name.trim().charAt(0) : "?";
}
