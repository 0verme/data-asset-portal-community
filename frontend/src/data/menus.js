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

function createMenu(item) {
  return {
    status: "enabled",
    adminOnly: false,
    icon: "grid",
    path: "",
    desc: "",
    navPlacement: "more",
    updatedAt: "2026-06-17 18:00:00",
    ...item,
  };
}

export const MENU_ITEMS = [
  createMenu({
    id: "1",
    code: "upstream",
    name: "上游卸数",
    icon: "download",
    path: "/upstream",
    order: 10,
    navPlacement: "primary",
    desc: "上游卸数系统列表与维护",
  }),
  createMenu({
    id: "2",
    code: "dwm",
    name: "数据仓库",
    icon: "db",
    path: "/data-warehouse",
    order: 20,
    navPlacement: "primary",
    desc: "DWM 表资产、字段与 DDL",
  }),
  createMenu({
    id: "3",
    code: "mapping",
    name: "字段映射",
    icon: "link",
    path: "/field-mapping",
    order: 30,
    navPlacement: "primary",
    desc: "字段与表的映射关系查询",
  }),
  createMenu({
    id: "lineage",
    code: "lineage",
    name: "血缘分析",
    icon: "layers",
    path: "/lineage",
    order: 35,
    navPlacement: "primary",
    desc: "任务与数据表的上下游血缘排查",
  }),
  createMenu({
    id: "4",
    code: "root",
    name: "词根管理",
    icon: "book",
    path: "/root-management",
    order: 40,
    desc: "词根、分类与批量导入",
  }),
  createMenu({
    id: "5",
    code: "indicator",
    name: "指标维护",
    icon: "hash",
    path: "/indicator-maintenance",
    order: 50,
    navPlacement: "primary",
    desc: "指标列表、详情与启停",
  }),
  createMenu({
    id: "6",
    code: "report",
    name: "报表资产",
    icon: "file",
    path: "/report-assets",
    order: 55,
    desc: "报表元数据台账、归属信息与关联引用",
  }),
  createMenu({
    id: "7",
    code: "apiAsset",
    name: "API 资产",
    icon: "api",
    path: "/api-assets",
    order: 58,
    desc: "API 元数据台账、参数、响应字段与关联资产维护",
  }),
  createMenu({
    id: "8",
    code: "push",
    name: "下游推送",
    icon: "upload",
    path: "/push",
    order: 60,
    desc: "下游推送系统、作业与字段",
  }),
  createMenu({
    id: "10",
    code: "codeTable",
    name: "码值表维护",
    icon: "table",
    path: "/code-table-maintenance",
    order: 65,
    desc: "湖仓手工码值表的表级元数据登记与维护",
  }),
  createMenu({
    id: "9",
    code: "system",
    name: "系统管理",
    icon: "shield",
    path: "/system-management",
    order: 70,
    adminOnly: true,
    desc: "用户、菜单、参数字典与操作日志（仅管理员可见）",
  }),
];
