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

import { AUTH_MODE, getAuthModeLabel, getMockHint } from "../auth.js";
import { Icon, initial } from "./ui.jsx";

function getSafeDisplayName(auth) {
  const user = String(auth?.user || "").trim();
  const name = String(auth?.name || "").trim();
  if (user && !/^\?+$/.test(user)) return user;
  if (name && !/^\?+$/.test(name) && name !== "管理员") return name;
  return "admin";
}

export const AuthContext = React.createContext({
  auth: { role: "guest", user: null, name: null, permissions: [] },
  can: () => false,
  canEdit: false,
  requireLogin: () => false,
  logout: async () => {},
});

export function useAuth() {
  return React.useContext(AuthContext);
}

export function LoginModal({ open, busy, error, onClose, onSubmit }) {
  const [user, setUser] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const userRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => userRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, open]);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setShowPassword(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    onSubmit({
      username: user.trim(),
      password,
      remember,
    });
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter") {
      submit();
    }
  };

  return (
    <div className="login-mask" onMouseDown={() => !busy && onClose()}>
      <div className="login-card" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button className="login-x" onClick={onClose} title="关闭" disabled={busy}>
          <Icon name="close" size={16} />
        </button>
        <div className="login-brand">
          <div className="brand-mark auth-brand-mark">
            <img src="/brand-icon.svg?v=20260609" alt="数据资产门户" />
          </div>
          <div>
            <div className="lb-name">数据资产门户</div>
            <div className="lb-sub">Data Asset Portal</div>
          </div>
        </div>
        <h2 className="login-title">管理员登录</h2>
        <p className="login-desc">
          登录后可新增、编辑与维护数据资产；游客可继续浏览全部内容。
        </p>
        <label className="login-field">
          <span className="lf-label">账号</span>
          <span className="lf-input">
            <Icon name="user" size={16} />
            <input
              ref={userRef}
              value={user}
              onChange={(event) => setUser(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="请输入管理员账号"
              autoComplete="username"
            />
          </span>
        </label>
        <label className="login-field">
          <span className="lf-label">密码</span>
          <span className={"lf-input" + (error ? " err" : "")}>
            <Icon name="key" size={16} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="lf-eye"
              onClick={() => setShowPassword((value) => !value)}
              title={showPassword ? "隐藏密码" : "显示密码"}
            >
              <Icon name={showPassword ? "eyeoff" : "eye"} size={16} />
            </button>
          </span>
        </label>
        <div className="login-row">
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span className="rm-box"><Icon name="check" size={12} /></span>
            记住登录
          </label>
          <span className="login-demo">
            {AUTH_MODE === "mock" ? <>演示 <code>{getMockHint()}</code></> : <code>{getAuthModeLabel()}</code>}
          </span>
        </div>
        {error ? <div className="login-err"><Icon name="info" size={14} />{error}</div> : null}
        <button className={"login-btn" + (busy ? " busy" : "")} onClick={submit} disabled={busy}>
          {busy ? <span className="spin"></span> : <Icon name="key" size={16} />}
          {busy ? "登录中..." : "登录"}
        </button>
        <button className="login-guest" onClick={onClose} disabled={busy}>
          以游客身份继续浏览
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </div>
  );
}

export function AuthBar({ auth, onLogin, onLogout }) {
  const displayName = getSafeDisplayName(auth);
  const roleLabel = auth.role === "admin"
    ? "系统管理员"
    : auth.role === "maintainer"
      ? "业务维护员"
      : auth.role || "游客浏览";

  if (!auth.user) {
    return (
      <div className="authbar">
        <span className="role-pill guest"><Icon name="eye" size={13} />游客浏览</span>
        <button className="login-cta" onClick={onLogin}>
          <Icon name="login" size={15} />
          登录
        </button>
      </div>
    );
  }

  return (
    <div className="authbar">
      <span className="role-pill admin"><Icon name="shield" size={13} />{roleLabel}</span>
      <div className="user-chip">
        <span className="uc-av">{initial(displayName)}</span>
        <span className="uc-name">{displayName}</span>
      </div>
      <button className="logout-btn" onClick={onLogout} title="退出登录">
        <Icon name="logout" size={15} />
      </button>
    </div>
  );
}
