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

import defaultMenus from "../../../config/default-menus.json" with { type: "json" };

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  icon: string;
  path: string;
  order: number;
  status: string;
  adminOnly: boolean;
  desc: string;
  navPlacement: string;
  updatedAt: string;
}

// Default/mock navigation projects the same manifest used by the backend seed.
export const MENU_ITEMS: readonly MenuItem[] = defaultMenus.map((menu) => ({
  id: String(menu.id),
  code: menu.code,
  name: menu.name,
  icon: menu.icon,
  path: menu.path,
  order: menu.order,
  status: menu.status,
  adminOnly: menu.adminOnly,
  desc: menu.desc,
  navPlacement: menu.navPlacement,
  updatedAt: "2026-06-17 18:00:00",
}));
