# DESIGN.md · data-asset-portal 视觉规范

> 本文件是 UI 修改的唯一风格依据。改动任何组件样式前先读它。
> 目标：克制、统一、有数据工具的高级感。**不是**满屏绿色，**不是**信息塞满。
> 核心原则一句话：**强调色稀缺、留白充足、一套 token 到底。**
>
> ⚠️ 本项目已有完整 token 体系，定义在 `app.css` 的 `:root`（深色）与
> `:root[data-theme="light"]`（浅色）中。**禁止新建颜色/圆角 token，一律复用下表中的现有变量。**
> 当前默认主题为 **浅色**（`data-theme="light"`）。

---

## 0. 改动纪律（给 AI 协作者）

- 一次只改一个页面或一类组件，改完等确认再铺开。不要一次重构五个页面。
- 只改样式，不动业务逻辑、数据流、接口。
- 颜色/圆角/间距**只能**用第 1 节列出的现有 token，**禁止散落 hex**，**禁止新建变量**。
- 离线约束不变：零 CDN、零 npm 在线安装、不引入网络字体（`--sans`/`--mono` 已是离线安全栈，勿改）。
- 改完自检：对照第 7 节 checklist 逐条过。

---

## 1. 设计 Token（已存在于 app.css，直接引用，勿改名）

所有组件只引用以下变量，**禁止散落 hex，禁止造新变量**。

```
/* ---- 强调色（克制使用，见 §2）---- */
--accent           主操作 / 在线 / 已启用，仅此两类场景
--accent-strong    hover / 加深
--accent-soft      绿色 tint 底（半透明）
--accent-soft-color 绿色 tint 字 / 高亮文字
--accent-line      绿色细线 / 左边线
/* 强调色文字用纯白时直接写 #fff */

/* ---- 中性色阶（界面 95% 由它构成）---- */
--ink      主文字
--ink-2    次要文字 / 标签
--ink-3    提示 / 占位 / 弱化
--bg       页面底
--surface  卡片 / 表格面
--surface-2 表头 / 弱化分区 / KPI 卡底
--surface-3 更深一层分区
--panel    面板底
--line     默认分割线
--line-2   更淡分割线
--line-strong 卡片边框 / 强调分割

/* ---- 语义色（仅状态用，均自带 -soft 底 与 -line 线）---- */
--accent / --accent-soft         在线 / 启用 / 成功（正向状态复用强调色族）
--warn   / --warn-soft / --warn-line     校验中 / 待补充
--danger / --danger-soft / --danger-line 缺失 / 禁用 / 异常
--info   / --info-soft / --info-line      信息 / 直接映射等中性提示
/* 无语义分类 badge（维度/分类）：底 --chip，字 --ink-2 */

/* ---- 圆角 ---- */
--radius-sm  8px   badge / tag / 小元素
--radius     12px  按钮 / 输入框 / 卡片 / 表格容器
/* 三档之外不新增；单边强调线配 border-radius:0 */

/* ---- 阴影 ---- */
--shadow-sm / --shadow-md / --shadow-lg  卡片悬浮层级

/* ---- 字体（离线安全栈，勿改）---- */
--sans   界面文字
--mono   表名 / 字段名 / 代码 / 标识符 / 数字
```

> 间距未设变量，沿用 8px 栅格手写：8 / 12 / 16 / 24 / 32 / 40 px。

---

## 2. 强调色规则（最重要，违反就不高级）

绿色（`--accent` 族）是稀缺资源。**同一屏可见的绿色强调元素 ≤ 4 处。**

绿色只允许出现在两类场景：
1. **主操作按钮**（查询、新增、扫描、进入等当前页主行为，每页通常只有 1 个）
2. **数据正向状态**（在线 / 已启用 / 成功 / 已映射）

绿色**不允许**出现在：
- 导航选中态 → 改用「`--ink` 深色文字 + 2px `--accent` 下边线 / 前置 `●` 小圆点」，去掉整块绿底胶囊
- 左侧筛选选中态 → 选中项用 `--surface-2` 浅底 + `--ink` 文字 + 绿色 `●` 圆点
- 普通图标、标题、装饰线、计数 badge

口诀：**问自己「这个绿能不能换成深灰（`--ink`/`--ink-2`）？」能换就换。** 只有"主操作"和"数据在线"两种情况换不掉。

---

## 3. 组件规范

### 3.1 按钮

| 类型 | 背景 | 文字 | 边框 | 用途 |
|---|---|---|---|---|
| primary | `--accent` | `#fff` | 无 | 每页唯一主操作 |
| secondary | `--surface` | `--ink` | `0.5px --line-strong` | 次操作（导出、重置） |
| text | 透明 | `--accent` | 无 | 轻量行为（查看详情） |
| danger | `--danger-soft` | `--danger` | 无 | 删除、禁用 |

- 尺寸：`padding: 8px 18px; font-size: 14px; font-weight: 500; border-radius: var(--radius);`
- 交互：`hover` 用 `--accent-strong` 或 `filter: brightness(1.05)`；`active` 加 `transform: scale(0.98)`
- 过渡：`transition: background .2s ease, transform .1s ease;`

### 3.2 KPI 数字卡（字段映射页 / 词根页顶部那排）

当前问题：数字和标签层级太平，像信息陈列而非仪表盘。

- 容器：`background: var(--surface-2); border: none; border-radius: var(--radius); padding: 16px 20px;`
- 数字：`font-size: 32px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.1;`
- 标签：`font-size: 13px; font-weight: 400; color: var(--ink-2); margin-top: 6px;`
- 副说明（如"覆盖率 96%"）：`font-size: 12px; color: var(--ink-3);`
- 卡片间距 `gap: 12px`，去掉边框，靠背景色差和留白区分。

### 3.3 表格

- 容器：`background: var(--surface); border: 0.5px solid var(--line-strong); border-radius: var(--radius); overflow: hidden;`
- 表头：`background: var(--surface-2);` 文字 `13px / 500 / --ink-2`
- 单元格：`padding: 12px 16px;` 主文字 `--ink`，次要列 `--ink-2`
- 行分割：仅 `border-bottom: 0.5px solid var(--line)`，**不要竖线、不要外层网格线**，最后一行无边框
- 行 hover：`background: var(--surface-2)`，`transition: background .15s`
- 数字列：右对齐 + `font-variant-numeric: tabular-nums`
- 标识符列（表名、字段名）：`font-family: var(--mono); font-size: 13px;`

### 3.4 Badge / Tag（全站统一为一套）

当前问题：维度标签、状态标签、分类标签三套样式不一致。统一为：

```css
.tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 500;
  padding: 3px 10px; border-radius: var(--radius-sm);
}
```

按语义取色，**禁止再造新样式**：

| 语义 | 类 | 底 / 字 |
|---|---|---|
| 正向状态（在线/启用/成功） | `.tag-ok` | `--accent-soft` / `--accent-soft-color` |
| 进行中（校验中/待补充） | `.tag-warn` | `--warn-soft` / `--warn` |
| 负向（缺失/禁用/异常） | `.tag-danger` | `--danger-soft` / `--danger` |
| 中性信息（直接映射等） | `.tag-info` | `--info-soft` / `--info` |
| 无语义分类（维度/分类标签） | `.tag-neutral` | `--chip` / `--ink-2` |

- 状态点用 `●`（实心=正向/启用）/ `○`（空心=离线/禁用），不靠颜色单独区分。
- 维度类标签（CONT 合同维度等）一律走 `.tag-neutral`，**不要给绿色**。

### 3.5 内容卡片（下游推送页系统卡）

- 容器：`--surface` + `0.5px --line-strong` + `--radius`，内边距 `20px 24px`
- 系统图标当前撞色（蓝/紫/橙）→ 统一降饱和：用同一柔和色板或 `--surface-3` 中性深底白字，避免抢绿色主调
- 卡内 字段:值 行：标签 `--ink-2`，值 `--ink`，行距 `12px`
- 卡片间距 `gap: 24px`

### 3.6 导航与左侧筛选

- 顶部导航：默认 `--ink-2`，hover `--ink`，选中 `--ink / 500` + 下方 2px `--accent` 细线。**不要绿底胶囊。**
- 左侧筛选：选中项 `background: --surface-2` + 文字 `--ink` + 前置 `●` 绿点；未选中 `--ink-2`，无背景。计数一律沿用现有 `.count`，**不要再额外包一层 badge/tag**。

左侧筛选栏的推荐结构：
- 第一组：业务分类筛选。标题按模块语义命名，如 `数据库类型`、`连接协议`、`指标维度`、`数据分层`、`主题域`、`词根分类`。
- 第二组：状态。仅在模块本身已有状态筛选能力时展示，标题固定为 `状态`，选项固定为 `全部状态 / 启用 / 禁用`。
- 第三组：维护。用于承载 `新增系统 / 新增指标 / 新增表 / 新增词根 / 批量导入` 等操作入口。
- 模块附加组：仅在确有独立语义时追加，例如下游推送的 `最近访问`。

左侧筛选栏优先复用共享组件，目录为 `frontend/src/components/sidebar/common/`：
- `SidebarFilterGroup.jsx`：通用分组组件，负责标题、选项列表、active、disabled、count 和点击事件。适用于业务分类组、最近访问组等普通分组。
- `StatusFilterGroup.jsx`：状态分组组件，固定渲染 `状态 / 全部状态 / 启用 / 禁用`。它只负责显示和回调，**不改动底层值语义**；`null`、`"all"`、`enabled`、`disabled` 等兼容关系由模块侧传入。
- `SidebarActionGroup.jsx`：维护分组组件，固定渲染 `维护`，通过 `actions` 配置承载新增、导入等入口。

共享 Sidebar 组件的约束：
- 继续复用现有 `.side-group / .side-title / .side-item / .count`，不要为通用 Sidebar 组件另起一套样式体系。
- 状态筛选统一为显式切换：点击 `启用 / 禁用` 不反选清空，回到全部只能点击 `全部状态`。
- 业务分类筛选是否支持“点击已选项取消”由各模块自行决定，通用组件不强制统一这一行为。
- 真正的左侧筛选栏模块应优先接入这 3 个组件，例如上游卸数、下游推送、指标维护、数据仓库、词根管理。
- 说明面板型左侧栏或模块导航型左侧栏先不要强行套入，例如 `MappingSidebar`、`SystemSidebar`。

### 3.7 列表状态与行操作（全站统一）

**状态展示一律用只读 pill**，组件为 `components/common/StateCards.jsx` 的 `StatusBadge`
（全站唯一实现，禁止再写本地副本）。两种调用方式：

- `<StatusBadge status={s} metaMap={X_STATUS_META} />`：按映射取文案/色调（系统管理、指标等）。
  不传 `metaMap` 时回退 enabled/disabled → 启用/禁用。
- `<StatusBadge on={bool} label="自定义" />`：二态开关型，默认文案 已启用/已禁用（推送、上游）。

色调走 `.tag-ok / .tag-danger / .tag-warn`（见 §3.4），自带 `●`(正向) / `○`(禁用/离线) 状态点。
**列表状态禁止再用 Switch 开关**（Switch 只保留在编辑器表单里设置状态）。

**行操作一律用共享 `RowActions`**（`components/common/RowActions.jsx`），禁止各页自写 `.btn` 行操作组。

- 固定按钮顺序：**查看 → 编辑 → 启用/禁用 → 业务动作(extraActions)**。
- 所有按钮**常驻显示**，不再 hover 浮出（已废弃 `.row-2nd` 隐藏逻辑）。
- 「启用/禁用」按钮根据 `toggle.enabled` 显示反向动作文案（当前启用→「禁用」，禁用→「启用」）。
- **列表页禁止删除类操作进入 `RowActions`**，包括删除、强制删除、清空、重置、批量删除、物理删除。
- `RowActions` 中的启用/禁用与标注 `confirm` 的普通业务动作统一走二次确认弹窗；
  传入 `RowActions` 的 `onToggle` 应为**裸操作**（确认已在组件内完成），hook 里不要再叠加确认。
- 删除只允许出现在编辑页 / 详情页底部的 `DangerZone`，统一复用 `DeleteConfirmDialog` / `confirmDeleteAction`。
- 颜色全走 token：编辑/启停/业务动作用中性 `.btn`（描边 `--line-strong`、字 `--ink-2`）；
  危险区删除用 `.btn.ghost-danger`（字 `--danger`、描边 `--danger-line`）。**禁止散落 hex。**
- 三态及以上状态（如用户 启用/锁定/禁用）不套二态 `toggle`，改用 `extraActions` 逐个列出反向动作，
  对禁用/锁定等收敛性动作挂 `confirm`。
- 容器 class 为 `.row-actions`（右对齐、`gap:8px`、可换行）。
  `.row-tools` 仅保留给编辑器内字段行的图标工具组（上移/下移/删除），不要用于列表行操作。

### 3.8 占位符 placeholder 文案

- **示例值型**：统一格式 `例如：xxx`，使用**中文全角冒号 `：`**（禁止半角 `:`），前缀与内容之间**不加空格**。涵盖示例文本、示例 ID、示例路径、格式模板（如 `SYS_XXX`、`dwm_xxx_detail_di`）。
- **指令型**：本身是操作引导而非示例值的（`请输入…`、`请选择…`、`搜索…`、`描述…用途`、`在当前表内筛选字段`、`补充…说明`），**不加 `例如：` 前缀**，保持原样。
- 禁止再出现 `如：`、`如 `、`例如 `（空格）、`例如:`（半角冒号）等变体。
- **豁免**：
  - (a) 数据网格 / 可编辑表格的单元格 placeholder 不套 `例如：`，保持简短（如字段行的 `field_name`、`中文名`、`来源系统`）。
  - (b) 多行格式模板（CSV 导入样例等）与动态变量 placeholder（`placeholder={变量}`）不适用本规范。

---

## 4. 间距与留白

- 页面主区左右留白 ≥ 32px，模块之间 ≥ 40px。
- 卡片内边距 ≥ 16px，重要卡片 24px。
- 信息密度宁可低不可高：指标管理这类多行文字页，行内说明限制 2 行 + 省略号（`-webkit-line-clamp: 2`）。
- 操作列拥挤时（编辑/删除/禁用三连）：收进 `⋯` 下拉，或仅在行 hover 时显示次要操作。

---

## 5. 圆角与分割线

- 圆角：badge/小元素 `--radius-sm`(8px)，按钮/输入/卡片/表格 `--radius`(12px)。两档之外不新增。
- 单边边框（`border-left` 强调线等）配 `border-radius: 0`，不要圆角。
- 分割线统一 0.5px + 低透明度（`--line`），靠留白和背景色差分区，**少用实线分割**。

---

## 6. 字体层级

| 层级 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 页面大标题 | 24px | 600 | `--ink` |
| 卡片/区块标题 | 16px | 500 | `--ink` |
| 正文 | 14px | 400 | `--ink` |
| 次要 / 标签 | 13px | 400 | `--ink-2` |
| 提示 / 占位 | 12px | 400 | `--ink-3` |
| KPI 数字 | 32px | 600 | `--ink` |

- 层级靠字号 + 字重 + 灰度区分，**不靠颜色**。
- 标识符、代码、表名、字段名一律 `--mono` 等宽字体。
- 数字一律 `font-variant-numeric: tabular-nums`。

---

## 7. 提交前自检 Checklist

- [ ] 本屏绿色强调元素 ≤ 4 处，且只在「主操作」「数据在线状态」
- [ ] 导航/筛选选中态没有整块绿底胶囊
- [ ] 所有 badge 走统一 `.tag-*`，无自造样式
- [ ] 维度/分类标签是中性灰（`.tag-neutral`），不是绿
- [ ] 数字列右对齐 + tabular-nums，标识符列 `--mono` 等宽字体
- [ ] 表格无竖线、无外层网格线，仅 0.5px 横向分割
- [ ] 颜色/圆角全部取自 §1 现有 token，无散落 hex，无新建变量
- [ ] 离线字体栈未改，无新增 CDN/网络字体
- [ ] KPI 数字卡数字够大够重、标签够淡
- [ ] 多行文字有 2 行截断，操作列不拥挤
- [ ] 浅色与深色两套主题下都核对一遍（切 `data-theme` 看效果）

---

## 8. 修改流程建议

1. 先改「字段映射」页作为风格基线，确认后再套用其他页。
2. 每页改完对照 §7 自检。
3. 不新增 token；如确有缺口，先在本文件记录并征求确认，保持单一事实来源。
