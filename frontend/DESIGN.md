# DAP 全站设计语言

本文为 DAP 新增及改造 UI 的设计依据。它描述当前产品方向和现有实现边界，不代表所有业务页面已经迁移完成。页面改造应按 Issue 分阶段实施；保留成熟业务交互、权限和数据行为，避免为追求外观一致而重写业务逻辑。

## 1. 产品定位与页面类型

产品定位统一为 **数据资产门户 / Data Asset Portal**。全站主要有两类页面：

| 页面类型 | 主要目标 | 布局原则 |
|---|---|---|
| Portal（门户首页） | 搜索发现与资产概览 | 搜索优先，内容聚焦，层次清楚，适当留白，品牌装饰可以更突出；内容宽度受约束 |
| Workspace（业务工作台） | 查找、维护和理解业务数据 | 操作效率优先，保留适当信息密度；按任务组合表格、卡片、筛选、详情和编辑，不照搬首页 Hero 或大面积留白 |

两类页面共享同一套颜色、文字、Surface、边框、状态、焦点和主题规则，也共享应用顶栏及通用反馈语言。它们可以采用不同的信息排序、内容密度和页面节奏。首页的球体、居中搜索、统计网格和局部留白属于 Portal 构成，不是业务模块模板。

## 2. 主题与外观偏好

### 2.1 当前支持和默认来源

外观偏好由 [AppearanceProvider](src/appearance/AppearanceProvider.tsx) 和 [preferences](src/appearance/preferences.ts) 管理，应用启动时由 [appearance bootstrap](appearance-bootstrap.js) 提前应用，主题 Token 在 [app.css](src/styles/app.css) 与 [kumo-theme.css](src/styles/kumo-theme.css) 中定义和桥接。

- 主题模式支持 **System / Light / Dark**。新偏好默认是 System；System 根据操作系统的 prefers-color-scheme 解析成 Light 或 Dark。
- 用户已保存的偏好优先于部署默认值。新偏好使用部署配置 VITE_DEFAULT_ACCENT；未配置或配置值无效时回落到 Green。仓库[示例配置](.env.example)目前填写 Green，但它不是所有部署和用户的强制默认主题。
- Accent 支持 **Green / Blue / Purple / Orange / Custom**。Blue、Orange 和自定义色会由当前主题的调色逻辑生成可读的 Accent Token；Green、Purple 的预设值在样式中定义。
- 当前[index.html](index.html)中的 Light / Green 是启动前的初始属性。运行时偏好会在应用渲染前读取并应用，不能据此将 Light 或 Green 描述为所有用户的默认选择。
- Compact / Comfortable 是可保存的密度偏好。Comfortable 为新偏好默认值；Compact 只在已有明确覆盖的区域改变间距，目前覆盖门户及部分目录表格、筛选栏和表单。它不是所有业务组件的全局缩放开关。见 [appearance-settings.css](src/appearance/appearance-settings.css) 与 [search.css](src/styles/search.css)。

### 2.2 Accent、品牌、语义和装饰

在设计或改造页面时区分以下含义：

1. **主题偏好**：System / Light / Dark、Accent、密度和动效偏好，是用户或部署的展示设置。
2. **品牌视觉**：由 Accent Token 表达。按钮、选中态、强调边框或 Kumo 品牌组件只有在使用对应 Token 时才随 Accent 改变。
3. **业务语义色**：success、warning、danger、info 表达结果或状态，使用各自语义 Token。Accent 切换不得把失败、警告或成功含义改成品牌色，也不得只靠颜色传达状态。
4. **页面装饰色**：背景渐变、Portal 光球和图形装饰服务于页面氛围，不代替品牌状态或业务语义。

Purple 是受支持的用户 Accent 之一；某张截图或测试选择 Purple 不表示所有用户默认使用 Purple。不要硬编码“全站默认绿色”，也不要将业务状态色接到 Accent 色族。

侧栏选中行、左侧强调线、选中数量徽标和普通占比进度条随当前 Accent 一起切换。参考稿中的具体色相由用户主题决定。例如，紫色主题下的启用比例条使用紫色，而表示“已启用”的状态点仍使用业务成功色。

## 3. Token 使用规则

### 3.1 现有全局设计 Token

全局颜色 Token 定义于 [app.css](src/styles/app.css)，Kumo 映射见 [kumo-theme.css](src/styles/kumo-theme.css)。

| 语义 | 现有 Token |
|---|---|
| 画布、背景和表面层级 | --bg、--bg-grad-1、--bg-grad-2、--surface、--surface-2、--surface-3、--panel |
| 文字 | --ink、--ink-2、--ink-3 |
| 边框与分隔 | --line、--line-2、--line-strong |
| 品牌强调 | --accent、--accent-strong、--accent-soft、--accent-soft-color、--accent-line、--on-accent、--chip |
| 业务状态 | --success / --success-soft / --success-line；--warn / --warn-soft / --warn-line；--danger / --danger-soft / --danger-line；--info / --info-soft / --info-line |
| 代码和技术内容 | --code-bg、--code-surface、--code-border、--code-text、--code-keyword、--code-field、--code-type、--code-comment |
| 字体 | --sans、--mono |
| 圆角和阴影 | --radius、--radius-sm；--shadow-sm、--shadow-md、--shadow-lg |

Kumo 桥接还定义 --dap-* 语义映射，并把它们映射到 Kumo 的颜色、字体和字号变量。--dap-* 是组件桥接层；--color-kumo-* 和其他 Kumo 变量是第三方组件契约。一般页面优先引用 DAP 全局 Token 或 Adapter，不应把 Kumo 内部变量当作新的全站设计 Token。详见 [UI Adapter README](src/ui/README.md)。

现有正文基线为 14px / 1.5；桥接字号包含 12、13、14、16px。具体标题和表格尺寸由页面及成熟业务组件承担，不把旧文档中的固定字号表当成全站 API。字体使用现有本地系统字体栈，不引入网络字体。

### 3.2 全局、组件和局部变量的边界

- **全局设计 Token** 跨页面共享，由现有 Appearance 与主题样式维护。新增全局 Token 前先说明现有 Token 为什么不能表达该语义；同一语义不得再建一份全局变量。
- **组件语义变量** 服务于 Kumo Adapter 或业务共享组件，应映射到全局 Token，并限制在对应组件或桥接层。
- **局部布局变量** 可以存在，用于一个页面或组件的布局计算。例如 [search.css](src/styles/search.css) 中作用于 Portal 的 --sp-*。定义必须有清楚的选择器作用域，不得把它宣传成全站公共设计 Token。

编写样式时优先复用现有 Token。页面不能随意硬编码主题颜色；状态、悬停和强调色均需适配 Light、Dark 和 Accent。局部尺寸和布局值可以由组件样式定义。本轮不要求增加任何 CSS 变量。

### 3.3 交互状态

- **Focus**：保留键盘可见焦点；优先使用 Adapter 和 Kumo 组件现有焦点表现。当前没有独立的全局 Focus Token，不要另造同义的全局颜色变量。
- **Hover**：使用对应控件已有的 Surface 或品牌强调状态；避免为单组件添加全局覆盖。主要操作不能只在 Hover 时才可发现。
- **Disabled / read-only**：保持不可操作、只读和业务状态的区别。使用控件语义与既有弱化文字 Token，不以降低透明度作为唯一说明。
- 成功、警告、危险等状态应同时有文本、图标或形状等可辨识线索，颜色只作为辅助。

## 4. 组件职责与页面模式

### 4.1 组件选择顺序

默认按以下顺序评估：

1. 已有 DAP UI Adapter（见 [Adapter API](src/ui/README.md)）。
2. 已有 DAP 业务共享组件（见 [common exports](src/components/common/index.ts) 和 [sidebar exports](src/components/sidebar/index.ts)）。
3. 已有成熟业务专用组件。
4. 具备正确语义和可访问名称的原生 HTML。
5. 在确认现有能力不足后，才新增共享组件或引入依赖。

对于高度专用的编辑器、数据表格、字段映射和血缘画布，维持成熟业务组件可以优先于新建通用抽象。禁止为了视觉统一而重写成熟业务逻辑或改变筛选、分页、编辑、保存和权限行为。业务页面禁止直接依赖 Kumo 深层组件路径；Kumo 深层导入限于 Adapter 实现与仓库明确的测试、Fixture 或兼容性探针。

### 4.2 已有组件与模式建议

| 页面区域 | 当前可用能力 | 使用边界 |
|---|---|---|
| 应用 Header | [App.tsx](src/App.tsx) 中的共享 topbar 和导航 | 门户与工作台共用应用导航；局部页面不要再造主导航 |
| PageHeader | [PageHeader](src/components/common/FormPageParts.tsx) | 现有业务共享标题、返回/面包屑、标题、副标题和状态；不含通用工具栏插槽。列表页当前也有自己的标题组合 |
| PageToolbar | 尚无通用共享 API | 作为页面模式建议：将搜索、筛选、排序、视图切换和主要操作放在清楚的工具区域；在窄屏允许换行或调整位置 |
| FilterSidebar | [sidebar/common](src/components/sidebar/common/SidebarFilterGroup.tsx) 中的 SidebarFilterGroup、StatusFilterGroup、SidebarActionGroup | 已有筛选栏和状态/操作分组；各模块保留自己的筛选值与权限语义。说明面板或模块导航侧栏不要强行套用 |
| CardGrid | [CardGridView](src/components/common/CardGridView.tsx)、GroupView 和 ViewModeSwitcher | CardGridView 是业务卡片列表模式；Kumo Adapter 的 Grid 是布局网格，不是资产卡片或表格 |
| DataTable | 没有通用 DAP DataTable Adapter | 复用现有模块表格。让列、状态、行操作适配真实任务密度；不要因“全站统一”重写专用表格 |
| Pagination | [TablePagination](src/ui/TablePagination.tsx) | 受控分页表现层；页面继续拥有请求、筛选与分页状态 |
| DetailSection | 没有通用共享 DetailSection API；有 [MetaItem](src/components/common/MetaItem.tsx) | 用清晰的小节标题组织详情字段；需要时组合 MetaItem，不要假定存在全局 Section 组件 |
| FormSection | [FormSection](src/components/common/FormSection.tsx) | 仅负责表单区块标题和内容，不管理值、校验或提交状态 |
| Modal / Dialog | [Dialog、FormModal、ConfirmDialog](src/ui/index.ts)；另有历史业务共享弹窗路径 | 新建通用交互优先评估 Adapter。表单错误和保存状态由调用页负责。common 中同名 FormModal 是不同实现/API，必须确认导入路径；现有业务弹窗可在迁移 Issue 中单独评估 |
| Loading / Empty / Error | Adapter 有 LoadingState、EmptyState、ErrorState 和 Banner；[common/StateCards.tsx](src/components/common/StateCards.tsx) 也提供同名业务状态组件 | 两套 API 并存，先沿用页面已依赖的稳定组件；新增公共控件时明确导入来源，不声称已全站迁移 |
| Toast | Adapter 导出 toast 与 ToastHost；[common/toastService.tsx](src/components/common/toastService.tsx) 是 Adapter 的兼容转出路径 | 应用入口已经挂载 ToastHost；页面调用 toast，不重复挂载 Host |

### 4.3 工作台的一致表达

Workspace 页面使用统一的标题层级、工具区域、Surface、表格分隔、表单字段、状态和反馈语言。保持列表信息可扫描、操作可预测、详情分组清楚；使用实际任务需要的列、摘要、筛选和行操作。卡片只用于适合比较或浏览的内容，不能为了低密度而把可读表格强制改为卡片。

Form 编辑流程应让标题、字段分组、校验、未保存状态和保存/取消操作清楚。继续保留页面既有确认、权限和错误语义。状态只读展示与状态编辑控件分开；不得用可交互 Switch 冒充只读状态标签。

#### 筛选型侧栏

数据源、目录等筛选项可放在独立圆角面板中，用标题和缩进区分维度，同级数量靠右对齐。选中项应有文字之外的可见标记。长菜单独立滚动，移动端沿用应用抽屉，确保最后一个筛选项和有权限的维护操作均可到达。

当用户需要了解覆盖范围或占比，且接口能提供可靠统计时，可在底部保留摘要空间。摘要使用轻边框和表面色，半透明效果在缺少模糊支持时仍须可读。标明统计范围：全局摘要使用接口的全量聚合，筛选结果使用对应查询的总数。首次加载与真实零值分别展示，分母为零时显示空进度，维护成功后随数据刷新。

### 4.4 状态、行操作和表单文字

- 业务状态优先复用 [common/StateCards.tsx](src/components/common/StateCards.tsx) 导出的 StatusBadge 与业务映射；通用语义提示使用 UI Adapter 的 Badge / Status。列表中的只读状态不做成开关，Switch 只用于实际可编辑的表单值。
- RowActions 是现有的业务共享行操作组合。适用时保留其查看、编辑、启停、附加动作顺序以及既有确认流程；不为统一样式绕开确认或把删除直接塞入普通行操作。删除使用页面已有的明确危险操作与确认流程。
- 表单示例值采用“例如：示例”的全角冒号格式；请输入、请选择、搜索等指令型提示直接说明操作，不加示例前缀。可编辑数据表格中的单元格提示应保持简短。该规则是后续改造的文案基准，不表示既有页面都已扫描或完成迁移。
- 标识符、表名、字段名和代码适合时沿用等宽字体；需要对齐比较的数值列使用等宽数字。不要为了套用固定样式影响可读性或业务数据本身。

## 5. 响应式与信息密度

- **Desktop**：Portal 保持搜索主次和内容宽度约束；Workspace 把空间给真实表格列、筛选和详情，同时控制表单及长文本宽度。
- **2K / 高分辨率**：可以展示更多有用列或并排信息，但不要无限拉伸首页、表单或单段文字。Portal 已有局部宽度变量与高视口间距规则，业务页面不应复制这些变量。
- **Tablet**：工具栏、筛选和操作可换行、折叠或调整顺序；主要操作和当前筛选仍须可发现。
- **Mobile**：先确保关键操作、字段和状态可访问。宽表允许受控横向滚动；可用 [WideTableScroll](src/components/common/WideTableScroll.tsx) 和模块现有窄屏模式。不能隐藏唯一操作，也不要只靠 Hover 展示操作。
- **Compact / Comfortable**：Comfortable 是偏好默认值。Compact 仅按当前代码的显式覆盖生效，不能假定它影响所有业务页面。密度调整不得破坏可读性、键盘焦点或移动端触控操作。

页面窄屏适配应保留原有权限、筛选、分页、编辑和保存行为。具体断点和像素值由实际布局和页面证据决定，不在此文档中臆造为全站规范。

## 6. CSS 与主题桥接约束

### 6.1 加载与 @layer

全局 CSS 的入口顺序在 [main.tsx](src/main.tsx)：Kumo standalone、app.css、push/report/upstream/indicator/system/search 模块样式，最后是 kumo-theme.css。Kumo 主题桥接依赖在 Kumo 和 DAP 全局/模块样式之后加载，并负责 Token 映射。

app.css 的盒模型和间距 Reset 有意将间距重置放在 @layer base 中，以保留 Kumo 控件的间距规则。新增或调整 CSS 时维持现有层级和入口顺序；不要增加未评估的全局 reset。Kumo Select 的原生 select 样式冲突已有局部处理：Adapter 会移除旧的 sel 类，样式中 .sel 继续服务原生控件。回归用例在 [select-reset.spec.ts](e2e/select-reset.spec.ts)。

### 6.2 样式归属

- app.css 承载全局 Token、应用 Shell 和仍未迁移的共享旧样式。
- 各业务模块样式文件承载对应模块规则；规则应以模块根类或明确组件类为作用域。
- src/ui 下的 ui.css、overlays.css、feedback.css、formErrors.css、TablePagination.css 归 Adapter 组件所有。
- kumo-theme.css 只桥接主题 Token，并包含少量明确针对 Kumo 控件的修正；不要把它当成普通业务页面覆盖文件。
- 避免宽泛的标签选择器或全局类覆盖来修复单一组件。优先修复组件自身的 class 和作用域。
- 避免不必要的 !important。桥接文件内已有针对 Kumo 品牌按钮内部变量的定点覆盖属于现有第三方适配；新增覆盖须有明确组件和回归依据。

## 7. P1 业务页面改造准入检查

以下是每个 P1 页面 PR 都应填写的验收清单，不是本轮已完成的视觉测试。未测试的项目保持未勾选，并明确标为“未验证”；附实际视口、主题/Accent、交互路径和视觉证据。

- [ ] 使用已确认的设计 Token。
- [ ] 优先复用现有 UI Adapter。
- [ ] 保留原有业务组件行为。
- [ ] 页面标题、工具栏及卡片样式符合 Workspace 规范。
- [ ] Light / Dark / System 三种主题模式兼容。
- [ ] Green / Blue / Purple / Orange / Custom Accent 无明显冲突，业务语义色保持清晰。在同一页面切换绿色与紫色，核对选中项、徽标与进度条同步变色，再检查其他预设及自定义色。
- [ ] Compact / Comfortable 无明显布局问题，并注明未覆盖区域。
- [ ] 桌面和移动端主要操作可访问。
- [ ] 不破坏权限、分页、筛选、编辑和保存。
- [ ] 提供实际视觉验收证据；未覆盖的组合明确标为未验证。

筛选型工作台可参考已落地的 [UpstreamSidebar](src/components/sidebar/UpstreamSidebar.tsx) 和[上游视觉回归](e2e/upstream-visual.spec.ts)。桌面截图保留侧栏和主内容同屏，移动端截图展开抽屉，检查滚动菜单时底部摘要是否遮挡操作。各模块按自身任务选择筛选维度和摘要指标。
