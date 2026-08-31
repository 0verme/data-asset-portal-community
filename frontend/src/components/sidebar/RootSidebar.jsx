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

import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";

export function RootSidebar({ root, requireLogin, canEdit = false, setRootRoute }) {
  const { roots, rootCategories, rootCategory, setRootCategory } = root;

  return (
    <>
      <SidebarFilterGroup
        title="词根分类"
        allOption={{
          key: "all-roots",
          label: "全部词根",
          count: roots.length,
          active: !rootCategory,
          onClick: () => setRootCategory(null),
        }}
        items={[
          ...rootCategories.map((item) => ({
            key: item.name,
            label: item.name,
            count: item.count,
            active: rootCategory === item.name,
            onClick: () => setRootCategory(rootCategory === item.name ? null : item.name),
          })),
        ]}
      />

      <SidebarActionGroup
        actions={canEdit ? [
          {
            key: "create-root",
            label: "新增词根",
            onClick: () => requireLogin(() => setRootRoute({ page: "new", abbr: null })),
          },
          {
            key: "import-root",
            label: "批量导入",
            onClick: () => requireLogin(() => setRootRoute({ page: "import", abbr: null })),
          },
        ] : []}
      />
    </>
  );
}
