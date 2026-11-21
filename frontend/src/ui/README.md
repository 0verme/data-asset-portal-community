# DAP UI Adapter 使用说明

本文记录 [src/ui/index.ts](./index.ts) 实际导出的 DAP UI Adapter API。Adapter 已经存在，不表示全站业务页面都已迁移。业务页改造遵循 [全站设计语言](../../DESIGN.md)，并保留既有业务行为。

## 1. 依赖与职责边界

当前 [package.json](../../package.json) 和 [package-lock.json](../../package-lock.json) 均锁定 **@cloudflare/kumo 2.18.1**。本轮只校正文档，不升级依赖。

- **Kumo** 提供底层组件和交互原语。
- **DAP UI Adapter** 位于 src/ui，管理 DAP 公共 API、语义、Token 桥接、ARIA 和少量跨页面兼容行为。
- **DAP 业务共享组件** 位于 src/components/common 和 src/components/sidebar，组合页面头部、筛选组、状态映射、行操作、详情字段和业务反馈等模式。
- **成熟业务组件** 位于各业务目录，拥有专用编辑、复杂表格或领域行为。

生产业务代码通过 src/ui/index.ts 使用 Adapter。不得从 @cloudflare/kumo/components/* 或 @cloudflare/kumo/primitives/* 深层导入 Kumo。深层导入仅留在 src/ui Adapter 实现及仓库明确的兼容性探针、测试和 Fixture，例如 [KumoCompatibilityFixture](../kumo-spike/KumoCompatibilityFixture.tsx)。

全局主题入口为 [app.css](../styles/app.css) 与 [kumo-theme.css](../styles/kumo-theme.css)。kumo-theme.css 将 DAP 画布、文字、边框、品牌、字体映射到 Kumo Token。不要把 Kumo 内部变量当作业务页公共 Token。

## 2. 选型指引

默认优先顺序：

1. 当前 Adapter 已覆盖的通用交互控件。
2. 当前业务已使用的 DAP 共享组件。
3. 成熟的业务专用表格、编辑器或图形组件。
4. 无对应能力时使用语义正确、可访问的原生 HTML。
5. 只有现有抽象确实无法满足时，新增 Adapter / 共享组件或依赖。

对于复杂表格、字段映射编辑器和血缘画布，保留成熟实现可以优先于创建通用抽象。不要为统一外观而重写业务行为。

### 工作台筛选侧栏

组合业务共享的 [SidebarFilterGroup](../components/sidebar/common/SidebarFilterGroup.tsx)、[StatusFilterGroup](../components/sidebar/common/StatusFilterGroup.tsx) 和 [SidebarActionGroup](../components/sidebar/common/SidebarActionGroup.tsx)。调用模块提供计数、筛选回调、权限和数据刷新。选中背景使用 `--accent-soft`，强调线和占比进度使用 `--accent`，徽标描边使用 `--accent-line`。布局和验收见[全站设计语言](../../DESIGN.md)，具体组合见 [UpstreamSidebar](../components/sidebar/UpstreamSidebar.tsx)。

## 3. 已导出的 Adapter API

下面列出的 API 均从 src/ui/index.ts 导出。组件是否已经被所有业务页面使用，需要逐页核对。

| 类别 | 导出 API | 当前契约和边界 |
|---|---|---|
| 按钮 | Button、IconButton | Button 变体 primary / secondary / tertiary / danger / outline；尺寸 sm / md，默认 secondary / md。IconButton 默认 square，必须提供 aria-label 或 aria-labelledby |
| 输入 | Input、Textarea、Field | Input、Textarea 支持受控 value + 原生 onChange，或非受控 defaultValue；intent 为 default / error，尺寸 sm / md。Field 包一项控件；error 会设置 aria-invalid 并关联可见错误 |
| 单选下拉 | Select | 单值；可用 value + onValueChange 或 defaultValue；支持 items 与 Option / Group / GroupLabel / Separator 组合；回调值可为空 |
| 搜索选择 | Combobox | 泛型 items/value；支持单值及 multiple 模式、onValueChange 和 Kumo 组合部件。清除、展示选项和移除标签的默认无障碍名称为中文 |
| 复选与开关 | Checkbox、Switch | 沿用 checked/defaultChecked 选择状态；回调 onCheckedChange 统一报告 boolean。Checkbox 的 indeterminate 会归一为 false |
| 标签 | Badge、Status | Badge 支持 filled 和 dot。filled tones 为 brand / neutral / success / warning / danger / info；dot/Status 支持 neutral / success / warning / danger |
| 标签页 | Tabs | appearance 为 segmented（默认）或 line，尺寸 sm / md；受控 value + onValueChange 或 defaultValue；滚动标签默认中文 |
| 布局 | Surface、Grid、GridItem、Breadcrumbs | Surface 暴露 Primary / Secondary；Grid 列数 2 / 3 / 4 / 6，gap density compact / normal / spacious（默认 compact），只影响该 Grid 的间隔，与 Appearance 的 Compact / Comfortable 无关；Breadcrumbs 项类型为 link / action / text |
| 分页 | TablePagination | 受控 page / pageSize / total 与变更回调；页面仍负责取数和筛选状态，不接管业务分页状态 |
| 表单错误 | FormField、FormErrorSummary、mergeFormFieldErrors、clearFormFieldErrors、focusFirstFormError、focusFormField、formErrorSummaryId、formFieldElementId | 提供稳定字段路径、内联错误、错误摘要和聚焦辅助；不拥有表单值、提交或业务校验规则 |
| 反馈 | Banner、LoadingState、EmptyState、ErrorState、SkeletonLine | Banner tone 为 info / warning / error / neutral；Loading、Empty、Error 只呈现状态，重试回调由页面提供 |
| 通知 | ToastHost、toast、DEFAULT_TOAST_DURATION、resolveToastDuration | toast 支持 success / error / warning / info；默认时长为 3200ms，由 [toastConfig.ts](./toastConfig.ts) 定义，可在调用时覆盖。应用入口已挂载 ToastHost，页面不重复挂载 |
| 浮层 | Dialog、FormModal、ConfirmDialog、ConfirmDialogHost、confirmAction、confirmDelete、confirmDeleteAction、Tooltip、TooltipProvider、Popover、DropdownMenu | 受控弹窗、确认流程、提示、菜单和弹出层的 DAP 入口，使用规则见下节 |
| 类型 | BadgeTone、ButtonVariant、ControlSize、GridColumns、GridDensity、TabAppearance、FormFieldErrors 及各组件 Props 类型 | 随组件 API 从 index.ts 导出；以当前类型定义为准 |

组件上声明的 className、ref、ARIA 或 data 属性仅在其 TypeScript Props 支持且底层 Kumo 控件接受时可用。不要假定每个 Adapter 都有 DOM ref；以导出类型为准。

### 受控与非受控

- Input / Textarea 遵循原生 input/change 语义。受控时使用 value 和 onChange；非受控时使用 defaultValue。readOnly 与 disabled 不可互换。
- Select 使用 value / onValueChange 受控，或只设置 defaultValue。Combobox、Tabs 遵循各自类型中声明的受控选择值与回调，或使用 defaultValue。不要同时传受控值和 defaultValue。
- Checkbox / Switch 使用 checked 和 onCheckedChange 受控，或使用 defaultChecked 非受控。onCheckedChange 提供 boolean。
- TablePagination 是受控展示组件：调用页管理页码、页大小、总数、取数和筛选。服务端归一化页大小继续由调用方传入。

## 4. Dialog、FormModal、ConfirmDialog 与 Toast

| API | 用途和实际边界 |
|---|---|
| Dialog | 受控 open / onOpenChange；需要 title；role 为 dialog 或 alertdialog；尺寸 sm / md / lg / xl；closeOnOutsideClick 默认开启。busy 时不允许关闭。Adapter 负责 DAP 浮层 Portal、模态语义、键盘焦点约束和焦点返回 |
| FormModal（src/ui） | 基于 Dialog 的表单式外壳，有标题、可选副标题/图标、取消和提交回调；它本身不创建 form、不管理校验和字段值。异步提交期间禁用关闭；调用方负责显示错误 |
| ConfirmDialog | 受控确认弹窗，可带详情、关键词和危险操作样式；异步确认失败时弹窗保持打开，由调用方展示错误 |
| ConfirmDialogHost + confirmAction / confirmDelete / confirmDeleteAction | 通过 Promise 驱动确认流程。调用方需挂载 Adapter 的 Host；没有 Host 时 confirmAction 返回 false。现有业务 [common/confirmService.tsx](../components/common/confirmService.tsx) 是不同服务边界，其 Host 当前由 App.tsx 挂载；迁移既有页面前确认实际使用路径 |
| ToastHost + toast | 应用入口由 [main.tsx](../main.tsx) 挂载 ToastHost；页面只调用 toast.success/error/warning/info。没有 Host 时 Adapter 保留 window.alert 回退，因此常规页面应依赖应用 Host，不单独挂载 |

Dialog 和 Tooltip 在 Adapter 内组合 Kumo 原语，以实现当前 DAP 的 Portal、焦点、role 和 aria-describedby 契约；这是 Adapter 内部实现边界，不允许业务页据此绕过 Adapter 深层导入。Tooltip 的 trigger 是 React 元素，调用 Tooltip 时传入 trigger 与 content，不以 Button 的 title 属性代替。

业务共享目录也存在同名的 FormModal、ConfirmDialog 和 LoadingState / EmptyState / ErrorState。特别是 [common index](../components/common/index.ts) 的 FormModal 来自旧业务实现，与 src/ui 的 FormModal 不是相同 API。新增代码明确从 src/ui/index.ts 或 common/index.ts 导入；已有模块先保持当前调用契约，再按 Issue 迁移。

## 5. Select 样式边界和兼容性

DAP Select 是 Kumo Select，不是原生 select。旧 .sel 类包含原生控件的箭头和表面样式，Adapter 会在传给 Kumo 前移除该类。不要给 Kumo Select 加回 .sel，也不要用全局 select 规则修复单个 Adapter。相关 Reset / 间距回归见 [select-reset.spec.ts](../../e2e/select-reset.spec.ts)。

## 6. 尚未迁移与验证依据

src/ui 是已实现的 Adapter API，不是迁移完成标记。当前上游卸数页已经在 [UpstreamView](../components/views/UpstreamView.tsx) 和 [UpstreamList](../components/upstream/UpstreamList.tsx) 中混用 Adapter 与业务共享组件；复杂表格、筛选侧栏、行操作及编辑逻辑仍属于各自业务组合。迁移时逐页检查真实导入，不因本说明而批量重写旧控件。

Adapter / 主题和选择框的现有浏览器用例包括 [kumo-adapters.spec.ts](../../e2e/kumo-adapters.spec.ts)、[kumo-overlays.spec.ts](../../e2e/kumo-overlays.spec.ts)、[kumo-compatibility.spec.ts](../../e2e/kumo-compatibility.spec.ts)、[select-reset.spec.ts](../../e2e/select-reset.spec.ts) 和 [table-pagination.spec.ts](../../e2e/table-pagination.spec.ts)。这些用例说明仓库存在相应回归覆盖；具体某次改造是否通过仍以该 PR 实际运行记录为准。

## 7. 业务页迁移核对

模块 PR 按[全站设计语言](../../DESIGN.md)第 8、9 节盘点完整视图并分别提交技术和视觉验收结果。PageToolbar、DetailSection 等模式名不能作为 Adapter 导入。修改共享组件或其 CSS 前搜索全部直接消费者，PR 中列出影响范围，并附每个受影响模块的回归证据。

- [ ] 使用 src/ui/index.ts 中已存在的 Adapter。
- [ ] 业务状态、权限和表单/分页状态仍由原业务组件管理。
- [ ] 保留成熟的专用表格、编辑器、字段映射和图形行为。
- [ ] 检查 Light / Dark / System、Accent、Compact / Comfortable 的真实覆盖范围。
- [ ] 检查桌面、平板、移动端的主要操作和焦点。
- [ ] 对未测试项标注 `UNVERIFIED`，不要将组件已导出等同于视觉验收通过。
