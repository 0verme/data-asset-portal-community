# 数据仓库 Workspace 视觉验收证据

截图对比基线为 `origin/main`（`d50e2d0`，含 PR #622 与 #624），改造后截图来自当前 P2 分支。两侧使用相同的 Chromium、Vite Mock 资产数据、管理员登录态和浅色主题；截图展示仓库内置的演示资产，不代表生产数据。截图保留共享 Header、筛选栏和 Footer，以便检查全站 Shell 回归。

新增的 `warehouse-visual.spec.ts` 还会验证 1920×1080、2560×1440、1440×900、768×1024、390×844 五种视口下的列表、卡片、分组与详情，并覆盖 DDL、新增、编辑和四种 Light/Dark、Accent、密度组合。CI 会将完整截图矩阵作为 `data-warehouse-workspace-screenshots` artifact 保存。

## 前后对照

| 区域 | 改造前 | 改造后 |
| --- | --- | --- |
| 列表（1920×1080） | [截图](before/list-1920.png) | [截图](after/list-1920.png) |
| 列表（1440×900） | [截图](before/list-1440.png) | [截图](after/list-1440.png) |
| 卡片（1440×900） | [截图](before/card-1440.png) | [截图](after/card-1440.png) |
| 分组（1440×900） | [截图](before/group-1440.png) | [截图](after/group-1440.png) |
| 详情字段（1440×900） | [截图](before/detail-fields-1440.png) | [截图](after/detail-fields-1440.png) |
| 详情字段（390×844） | [截图](before/detail-fields-390.png) | [截图](after/detail-fields-390.png) |
| DDL（1440×900） | [截图](before/detail-ddl-1440.png) | [截图](after/detail-ddl-1440.png) |
| 新增（1440×900） | [截图](before/new-1440.png) | [截图](after/new-1440.png) |
| 编辑（1440×900） | [截图](before/edit-1440.png) | [截图](after/edit-1440.png) |
| 编辑（390×844） | [截图](before/edit-390.png) | [截图](after/edit-390.png) |

## 主题与密度

- [Dark / Purple / Comfortable 卡片](after/card-dark-purple.png)
- [Light / Orange / Compact 卡片](after/card-light-orange-compact.png)

完整的 Green、Blue、Purple、Orange 与两种密度截图由 Chromium E2E 用例及 CI artifact 保存。
