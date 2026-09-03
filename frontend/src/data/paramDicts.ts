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

export interface ParamDictCategory {
  code: string;
  name: string;
  desc: string;
  status: string;
}

export const PARAM_DICT_CATEGORIES: readonly ParamDictCategory[] = [
  {
    code: "USER_STATUS",
    name: "用户状态",
    desc: "后台用户账号状态定义",
    status: "enabled",
  },
  {
    code: "SYSTEM_STATUS",
    name: "系统状态",
    desc: "系统启停状态与可用性标识",
    status: "enabled",
  },
  {
    code: "PUSH_PROTOCOL",
    name: "推送协议",
    desc: "下游推送系统支持的协议类型",
    status: "enabled",
  },
  {
    code: "FILE_ENCODING",
    name: "文件编码",
    desc: "文件传输常用编码配置",
    status: "enabled",
  },
] as const;

export interface ParamDictItem {
  id: string;
  categoryCode: string;
  code: string;
  name: string;
  value: string;
  status: string;
  desc: string;
  updatedAt: string;
}

function createParamDict(
  item: Partial<ParamDictItem> &
    Pick<ParamDictItem, "id" | "categoryCode" | "code" | "name" | "value">,
): ParamDictItem {
  return {
    status: "enabled",
    updatedAt: "2026-06-17 18:00:00",
    desc: "",
    ...item,
  };
}

export const PARAM_DICT_ITEMS: readonly ParamDictItem[] = [
  createParamDict({
    id: "DICT001",
    categoryCode: "USER_STATUS",
    code: "ENABLED",
    name: "启用",
    value: "enabled",
    updatedAt: "2026-06-17 09:18:00",
    desc: "账号正常可登录",
  }),
  createParamDict({
    id: "DICT003",
    categoryCode: "USER_STATUS",
    code: "DISABLED",
    name: "禁用",
    value: "disabled",
    updatedAt: "2026-06-17 09:18:00",
    desc: "账号已禁用，不可登录",
  }),
  createParamDict({
    id: "DICT004",
    categoryCode: "SYSTEM_STATUS",
    code: "ONLINE",
    name: "启用",
    value: "enabled",
    updatedAt: "2026-06-16 16:25:00",
    desc: "系统正常启用",
  }),
  createParamDict({
    id: "DICT005",
    categoryCode: "SYSTEM_STATUS",
    code: "OFFLINE",
    name: "禁用",
    value: "disabled",
    updatedAt: "2026-06-16 16:25:00",
    desc: "系统暂停使用",
  }),
  createParamDict({
    id: "DICT006",
    categoryCode: "PUSH_PROTOCOL",
    code: "OSS",
    name: "OSS",
    value: "OSS",
    updatedAt: "2026-06-15 11:02:00",
    desc: "演示对象存储交付协议",
  }),
  createParamDict({
    id: "DICT007",
    categoryCode: "PUSH_PROTOCOL",
    code: "HTTP",
    name: "HTTP",
    value: "HTTP",
    updatedAt: "2026-06-15 11:02:00",
    desc: "HTTP 接口推送",
  }),
  createParamDict({
    id: "DICT008",
    categoryCode: "FILE_ENCODING",
    code: "UTF8",
    name: "UTF-8",
    value: "UTF-8",
    updatedAt: "2026-06-14 15:46:00",
    desc: "默认统一编码",
  }),
  createParamDict({
    id: "DICT009",
    categoryCode: "FILE_ENCODING",
    code: "GBK",
    name: "GBK",
    value: "GBK",
    updatedAt: "2026-06-14 15:46:00",
    desc: "兼容部分存量文件传输",
  }),
] as const;
