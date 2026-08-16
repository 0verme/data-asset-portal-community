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

import { useCallback, useEffect, useState } from "react";
import {
  clearAuthStorage,
  GUEST_AUTH,
  getInitialAuth,
  hydrateAuth,
  login,
  logout,
} from "../auth.js";
import { isUnauthorizedError } from "../api/http.js";
import { getErrorMessage } from "../utils/ui.js";
import { toast } from "../components/common/index.js";

export function useAuthSession() {
  const [auth, setAuth] = useState(getInitialAuth);
  const [authReady, setAuthReady] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const canEdit = ["admin", "maintainer"].includes(auth.role);
  const canManageSystem = auth.role === "admin";

  const requireLogin = useCallback((action) => {
    if (canEdit) {
      action?.();
      return true;
    }
    setAuthError("");
    setLoginOpen(true);
    return false;
  }, [canEdit]);

  const runProtectedMutation = useCallback(async (task, fallbackMessage) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return false;
    }
    try {
      await task();
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) return false;
      toast.error(getErrorMessage(error, fallbackMessage));
      return false;
    }
  }, [canEdit]);

  useEffect(() => {
    let alive = true;

    hydrateAuth()
      .then((nextAuth) => {
        if (!alive) return;
        setAuth(nextAuth);
        setAuthReady(true);
      })
      .catch((error) => {
        if (!alive) return;
        if (!isUnauthorizedError(error)) {
          console.error("Failed to hydrate auth state", error);
        }
        clearAuthStorage();
        setAuth({ ...GUEST_AUTH });
        setAuthReady(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthStorage();
      setAuth({ ...GUEST_AUTH });
      setAuthBusy(false);
      setAuthError("登录状态已失效，请重新登录。");
      setLoginOpen(true);
    };

    window.addEventListener("app:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("app:unauthorized", handleUnauthorized);
  }, []);

  const handleLoginSubmit = async (credentials) => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const nextAuth = await login(credentials);
      setAuth(nextAuth);
      setLoginOpen(false);
    } catch (error) {
      setAuthError(getErrorMessage(error, "登录失败，请稍后重试。"));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        toast.error(getErrorMessage(error, "退出登录失败，请稍后重试。"));
      }
    } finally {
      clearAuthStorage();
      setAuth({ ...GUEST_AUTH });
      setAuthError("");
      setLoginOpen(false);
    }
  };

  return {
    auth,
    authReady,
    canEdit,
    canManageSystem,
    loginOpen,
    setLoginOpen,
    authBusy,
    authError,
    setAuthError,
    requireLogin,
    runProtectedMutation,
    handleLoginSubmit,
    handleLogout,
  };
}
