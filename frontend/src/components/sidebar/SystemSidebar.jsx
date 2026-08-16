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

export function SystemSidebar({ systemRoute, setSystemRoute, setSystemActionIntent, canManageSystem }) {
  if (!canManageSystem) {
    return <div className="side-group"><div className="side-title">操作日志</div></div>;
  }
  return (
    <>
      <div className="side-group">
        <div className="side-title">系统管理</div>
        <div className={"side-item" + (systemRoute.page === "users" ? " active" : "")} onClick={() => setSystemRoute({ page: "users" })}>
          用户管理
        </div>
        <div className={"side-item" + (systemRoute.page === "menus" ? " active" : "")} onClick={() => setSystemRoute({ page: "menus" })}>
          菜单管理
        </div>
        <div className={"side-item" + (systemRoute.page === "param-dicts" ? " active" : "")} onClick={() => setSystemRoute({ page: "param-dicts" })}>
          参数字典
        </div>
        <div className={"side-item" + (systemRoute.page === "operation-logs" ? " active" : "")} onClick={() => setSystemRoute({ page: "operation-logs" })}>
          操作日志
        </div>
      </div>

      {systemRoute.page !== "operation-logs" ? (
        <div className="side-group">
          <div className="side-title">维护</div>
          {systemRoute.page === "menus" ? (
            <div className="side-item" onClick={() => setSystemActionIntent("new-menu")}>新增菜单</div>
          ) : systemRoute.page === "param-dicts" ? (
            <div className="side-item" onClick={() => setSystemActionIntent("new-param")}>新增参数</div>
          ) : (
            <div className="side-item" onClick={() => setSystemActionIntent("new-user")}>新增用户</div>
          )}
        </div>
      ) : null}
    </>
  );
}
