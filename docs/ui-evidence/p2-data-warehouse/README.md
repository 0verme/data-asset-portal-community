# 数据仓库 Workspace 视觉验收证据

截图对比基线为 `origin/main`（`d50e2d0`，含 PR #622 与 #624），改造后截图来自当前 P2 分支。十组对照均为 Chromium、中文、Light / Green、Comfortable、管理员，使用相同的 Vite Mock 资产数据；截图展示仓库内置的演示资产，不代表生产数据。截图保留共享 Header、筛选栏和 Footer，以便检查全站 Shell 回归。

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

## 其他验收样本

| 页面与状态 | 视口 | 语言 / 外观 / 密度 | 数据与身份 |
| --- | --- | --- | --- |
| [六列目录与内容上限](after/list-2560.png) | 2560×1440 | 中文 / Light Green / Comfortable | Mock 管理员 |
| [平板分组与工具栏](after/group-768.png) | 768×1024 | 中文 / Light Green / Comfortable | Mock 管理员 |
| [双维抽屉、选中主题域](after/drawer-390.png) | 390×844 | 中文 / Dark Green / Comfortable | Mock 游客 |
| [列表与侧栏](after/en-list-1440.png) | 1440×900 | 英文 / Dark Blue / Compact | Mock 管理员 |
| [详情操作](after/en-detail-390.png)、[必填校验摘要](after/en-validation-390.png) | 390×844 | 英文 / Dark Blue / Compact | Mock 管理员 |
| [字段表滚至最右列](after/fields-scroll-390.png)、[字段编辑行](after/field-editor-390.png)、[表名删除确认](after/delete-390.png)、[目录搜索无匹配](after/empty-390.png) | 390×844 | 英文 / Light Green / Comfortable | Mock 管理员 |
| [非空风险与字段深链焦点](after/risk-field-link.png) | 1440×900 | 英文 / Light Green / Comfortable | Remote 模式，Playwright 拦截 HTTP，合成资产及管理员 |

字段类型使用仓库详情作用域内的 `--ink-2`。在白色表面上，Chromium 与 WebKit 均测得 7.98∶1。移动字段表可横向滚动 380px 至最后一列；390px 英文校验摘要另有容器宽度断言。桌面超过 1320px 时检查主内容上限。前后截图均包含共享 Shell。

真实部署的权限、外部风险处置链接的目的页面、业务方视觉签收均为 **UNVERIFIED**。
