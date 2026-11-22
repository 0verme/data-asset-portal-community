# DAP 全站设计语言 · Design System V2.0

本文为 DAP 新增及改造 UI 的设计依据。它描述当前产品方向和现有实现边界，不代表所有业务页面已经迁移完成。每个业务模块默认以一个 Issue 约定范围、一个 PR 完成交付。保留成熟业务交互、权限和数据行为，避免为追求外观一致而重写业务逻辑。

## 1. 产品定位与页面类型

产品定位统一为 **数据资产门户 / Data Asset Portal**。全站主要有两类页面：

| 页面类型 | 主要目标 | 布局原则 |
|---|---|---|
| Portal（门户首页） | 搜索发现与资产概览 | 搜索优先，内容聚焦，层次清楚，适当留白，品牌装饰可以更突出；内容宽度受约束 |
| Workspace（业务工作台） | 查找、维护和理解业务数据 | 操作效率优先，保留适当信息密度；按任务组合表格、卡片、筛选、详情和编辑，不照搬首页 Hero 或大面积留白 |

两类页面共享同一套颜色、文字、Surface、边框、状态、焦点和主题规则，也共享应用顶栏及通用反馈语言。它们可以采用不同的信息排序、内容密度和页面节奏。首页的球体、居中搜索、统计网格和局部留白属于 Portal 构成，不是业务模块模板。

### 1.1 三层架构

| 层次 | 负责的设计决策 | 实施入口 |
|---|---|---|
| Design System | 颜色 Token、字体层级、Surface、圆角、阴影、间距、Accent 与业务语义色；Focus / Hover / Disabled；明暗模式与密度偏好 | 优先采用第 2、3 节的现有 Token 和外观机制，局部间距沿用所属组件 |
| Application Shell | 品牌 Logo 与名称、主导航与更多菜单、全局搜索入口、语言与外观设置、用户操作、移动导航、全站 Footer、内容滚动与页面框架 | 直接复用共享 Shell，布局与回归要求见第 4 节 |
| Workspace Pattern | 页面标题与工具栏、侧栏、卡片与表格、分页、详情与表单分组、加载与错误反馈、弹窗、Toast 和业务操作按钮 | 第 5 节区分已导出的组件、模块内组合和候选模式。模块负责数据、权限与操作行为 |

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

## 4. Application Shell

### 4.1 Header 与主导航

首页和业务工作台复用 [App.tsx](src/App.tsx) 的同一个 Header。业务模块不得另建 Header、主导航或复制 `.mainnav`。导航容器和按钮的圆角、Surface 背景、边框、阴影、间距与项高以 [app.css](src/styles/app.css) 的共享选择器为准。Hover 加深文字，当前主导航项用字重与 Accent 下划线标识；保留 Adapter 的键盘可见焦点和禁用语义（如菜单加载提示）。验收时比较同一视口、同一主题下的实际样式。

- 桌面左侧为 Logo 和品牌名，中间为导航槽，右侧为语言、主题快捷切换、外观设置与登录或用户操作。首页为中央胶囊两侧预留对称空间，搜索位于门户内容；业务工作台在右侧容纳全局搜索，胶囊使用两侧之间的可用宽度。
- 按权限取得可见菜单，再按配置位置和实测的导航槽、菜单项及“更多”按钮宽度分配主导航。其余可见项进入“更多”；当前页在其中时应可辨认。检查打开、键盘关闭与焦点返回、选择后收起并切换模块。禁止写死可见菜单数，或让导航与品牌、搜索、用户区重叠。
- 窄屏沿用 Shell 的 Hamburger 和模块导航抽屉。在提供侧栏的页面检查打开、选择模块、Escape 关闭和焦点返回；工作台移动搜索与抽屉互斥。语言入口按现有断点在顶栏或抽屉内可达。用中英文、游客和登录用户实测长菜单名、搜索聚焦、用户信息及权限导致的菜单数量变化。

### 4.2 Footer 与主内容滚动

全站 Footer 由 [App.tsx](src/App.tsx) 的共享 `footer` JSX 提供一个 `contentinfo` 区域。首页产品名取 `branding.site.display_name`，其他页面取 `branding.site.title`。版本文本、Release 链接和 GitHub 项目入口分别读取 `APP_RELEASE_METADATA.version`、`releaseUrl` 和 `repositoryUrl`；保留现有构建元数据来源和新窗口链接语义，禁止在业务页硬编码版本。见 [Release 元数据](src/config/releaseMetadata.ts)

| 页面 | DOM 与滚动归属 | 回归观察点 |
|---|---|---|
| Portal 首页 | Footer 在 `main.portal-home-main` 内，位于 `.main-inner` 之后 | 短内容随布局靠底；内容较长时随主区滚动，在统计面板之后可见 |
| Workspace | Footer 在 `.body` 之后，与其同属应用外壳；主区独立滚动 | 短页页脚与外壳底部对齐；长页滚到底仍可见最后一行、分页或保存按钮，Footer 不覆盖内容 |

两处沿用同一组样式：继承应用字体，小号次级文字（`--ink-2`），内容居中、紧凑排列；透明背景，以留白与正文分隔。链接 Hover 使用 `--ink`，键盘焦点使用 `--accent-line` 轮廓。保留底部安全区间距；移动端允许产品名与链接合理换行，检查两条链接均在可视宽度内且可操作。每个模块 PR 必须回归 Footer；符合契约时直接复用。

## 5. Workspace Pattern 与组件选型

### 5.1 组件选择顺序

默认按以下顺序评估：

1. 已有 DAP UI Adapter（见 [Adapter API](src/ui/README.md)）。
2. 已有 DAP 业务共享组件（见 [common exports](src/components/common/index.ts) 和 [sidebar exports](src/components/sidebar/index.ts)）。
3. 已有成熟业务专用组件。
4. 具备正确语义和可访问名称的原生 HTML。
5. 在确认现有能力不足后，才新增共享组件或引入依赖。

对于高度专用的编辑器、数据表格、字段映射和血缘画布，维持成熟业务组件可以优先于新建通用抽象。禁止为了视觉统一而重写成熟业务逻辑或改变筛选、分页、编辑、保存和权限行为。业务页面禁止直接依赖 Kumo 深层组件路径；Kumo 深层导入限于 Adapter 实现与仓库明确的测试、Fixture 或兼容性探针。

### 5.2 已有组件与模式建议

| 页面区域 | 当前可用能力 | 使用边界 |
|---|---|---|
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

### 5.3 工作台的一致表达

Workspace 页面使用统一的标题层级、工具区域、Surface、表格分隔、表单字段、状态和反馈语言。保持列表信息可扫描、操作可预测、详情分组清楚；使用实际任务需要的列、摘要、筛选和行操作。卡片只用于适合比较或浏览的内容，不能为了低密度而把可读表格强制改为卡片。

Form 编辑流程应让标题、字段分组、校验、未保存状态和保存/取消操作清楚。继续保留页面既有确认、权限和错误语义。状态只读展示与状态编辑控件分开；不得用可交互 Switch 冒充只读状态标签。

#### Workspace 参考矩阵

上游卸数是已落地的视觉参考。标题与工具栏、卡片表面、表格分隔、页面间距、操作层级及信息密度可以复用；字段、DOM 和流程由本模块任务决定。数据仓库保留专用表编辑器，字段映射保留宽表与字段编辑，血缘分析保留画布，下游推送保留任务管理流程。

| 设计区域 | 当前参考实现 | 复用原则 |
|---|---|---|
| Header / Footer | [App.tsx](src/App.tsx) | 直接复用，按第 4 节回归 |
| 工作台标题、工具栏与表格 | [UpstreamList](src/components/upstream/UpstreamList.tsx) | 参考标题、视图切换、主次操作与行信息层级 |
| 筛选侧栏 | [UpstreamSidebar](src/components/sidebar/UpstreamSidebar.tsx) | 采用适用的筛选维度和分组 |
| 卡片 | [CardGridView](src/components/common/CardGridView.tsx) | 已有卡片视图优先复用，摘要由模块提供 |
| 分页 | [UpstreamView](src/components/views/UpstreamView.tsx) 使用 TablePagination | 复用 Adapter，页码、筛选与取数仍归业务页 |
| 详情 | [UpstreamDetail](src/components/upstream/UpstreamDetail.tsx) | 参考字段分组、状态与操作位置 |
| 新增与编辑 | [UpstreamEditor](src/components/upstream/UpstreamEditor.tsx) | 参考控件、分组、校验和保存反馈 |

#### 侧栏类型与筛选交互

先确定侧栏用途。筛选型组织维度、计数与重置；导航型标识当前位置与可到达的入口；资产树 / Schema 树保留父子层级、展开与节点选择；复杂编辑器专用侧栏保留其上下文、编辑与定位行为。后三类沿用公共文字、选中、焦点及滚动规则，各自决定内容结构。

筛选型侧栏按维度命名分组，数量徽标对应同一统计口径。适用时提供清空筛选入口，恢复该模块默认条件；默认条件下应禁用清空。维护入口沿用权限判断。底部摘要可选，上游的系统覆盖统计仅适用于有对应全量数据的任务，禁止为填充侧栏推算缺失指标。

桌面 Workspace 侧栏采用「Shell 侧栏轨道 → 单一主容器 → 业务 Section → 筛选项或导航项」。轨道负责宽度、定位和响应式布局，默认透明。主容器统一绘制 Surface、边框、圆角和阴影。Section 使用标题、折叠、留白或淡分隔线区分维度。避免在贯穿整列的实色背景上叠加实色主面板，再为每组绘制完整卡片。

上游卸数、数据仓库和其他 Workspace 共享这套层级，筛选维度和组件实现由业务决定。风险提示、维护操作区、数据摘要、特殊导航树或状态说明需要独立容器时，应在 PR 中说明用途，并降低相对于主容器的背景、边框和阴影强度。

同级数量靠右对齐。选中项应有文字之外的可见标记。Accent 用于选中、焦点、状态和操作反馈，避免在嵌套容器上重复铺设大面积强调色。使用主题令牌适配 Light / Dark 以及 Green、Blue、Purple、Orange 和 Custom。

移动端沿用第 4 节的 Shell 抽屉与模块导航。保留侧栏滚动、选择后关闭、Escape 和焦点返回，按安全区域和小屏可用高度布局。最后一个筛选项和有权限的维护操作均应可达，底部摘要应避开操作区。

当用户需要了解覆盖范围或占比，且接口能提供可靠统计时，可在底部保留摘要空间。摘要使用轻边框和表面色，半透明效果在缺少模糊支持时仍须可读。标明统计范围：全局摘要使用接口的全量聚合，筛选结果使用对应查询的总数。首次加载与真实零值分别展示，分母为零时显示空进度，维护成功后随数据刷新。

### 5.4 状态、行操作和表单文字

- 业务状态优先复用 [common/StateCards.tsx](src/components/common/StateCards.tsx) 导出的 StatusBadge 与业务映射；通用语义提示使用 UI Adapter 的 Badge / Status。列表中的只读状态不做成开关，Switch 只用于实际可编辑的表单值。
- RowActions 是现有的业务共享行操作组合。适用时保留其查看、编辑、启停、附加动作顺序以及既有确认流程；不为统一样式绕开确认或把删除直接塞入普通行操作。删除使用页面已有的明确危险操作与确认流程。
- 表单示例值采用“例如：示例”的全角冒号格式；请输入、请选择、搜索等指令型提示直接说明操作，不加示例前缀。可编辑数据表格中的单元格提示应保持简短。该规则是后续改造的文案基准，不表示既有页面都已扫描或完成迁移。
- 标识符、表名、字段名和代码适合时沿用等宽字体；需要对齐比较的数值列使用等宽数字。不要为了套用固定样式影响可读性或业务数据本身。

## 6. 响应式与信息密度

- **Desktop**：Portal 保持搜索主次和内容宽度约束；Workspace 把空间给真实表格列、筛选和详情，同时控制表单及长文本宽度。
- **2K / 高分辨率**：可以展示更多有用列或并排信息，但不要无限拉伸首页、表单或单段文字。Portal 已有局部宽度变量与高视口间距规则，业务页面不应复制这些变量。
- **Tablet**：工具栏、筛选和操作可换行、折叠或调整顺序；主要操作和当前筛选仍须可发现。
- **Mobile**：先确保关键操作、字段和状态可访问。宽表允许受控横向滚动；可用 [WideTableScroll](src/components/common/WideTableScroll.tsx) 和模块现有窄屏模式。不能隐藏唯一操作，也不要只靠 Hover 展示操作。
- **Compact / Comfortable**：Comfortable 是偏好默认值。Compact 仅按当前代码的显式覆盖生效，不能假定它影响所有业务页面。密度调整不得破坏可读性、键盘焦点或移动端触控操作。

页面窄屏适配应保留原有权限、筛选、分页、编辑和保存行为。具体断点和像素值由实际布局和页面证据决定，不在此文档中臆造为全站规范。

## 7. CSS 与主题桥接约束

### 7.1 加载与 @layer

全局 CSS 的入口顺序在 [main.tsx](src/main.tsx)：Kumo standalone、app.css、push/report/upstream/indicator/system/search 模块样式，最后是 kumo-theme.css。Kumo 主题桥接依赖在 Kumo 和 DAP 全局/模块样式之后加载，并负责 Token 映射。

app.css 的盒模型和间距 Reset 有意将间距重置放在 @layer base 中，以保留 Kumo 控件的间距规则。新增或调整 CSS 时维持现有层级和入口顺序；不要增加未评估的全局 reset。Kumo Select 的原生 select 样式冲突已有局部处理：Adapter 会移除旧的 sel 类，样式中 .sel 继续服务原生控件。回归用例在 [select-reset.spec.ts](e2e/select-reset.spec.ts)。

### 7.2 样式归属

- app.css 承载全局 Token、应用 Shell 和仍未迁移的共享旧样式。
- 各业务模块样式文件承载对应模块规则；规则应以模块根类或明确组件类为作用域。
- src/ui 下的 ui.css、overlays.css、feedback.css、formErrors.css、TablePagination.css 归 Adapter 组件所有。
- kumo-theme.css 只桥接主题 Token，并包含少量明确针对 Kumo 控件的修正；不要把它当成普通业务页面覆盖文件。
- 避免宽泛的标签选择器或全局类覆盖来修复单一组件。优先修复组件自身的 class 和作用域。
- 避免不必要的 !important。桥接文件内已有针对 Kumo 品牌按钮内部变量的定点覆盖属于现有第三方适配；新增覆盖须有明确组件和回归依据。

### 7.3 修改前盘点与回归范围

| 修改位置 | 提交前必须确定 | 改动后必须验证 |
|---|---|---|
| 模块 CSS | 以模块根类限定规则；确认选择器实际命中哪些视图 | 本模块相关列表、详情、表单、状态与断点 |
| 共享组件及样式 | 搜索导入、重导出、调用点及同名 CSS 类，列出所有直接消费者 | 每个直接受影响模块的对应视图和交互 |
| 全局 app.css | 列出受影响选择器、页面和状态；单页问题先在模块作用域解决 | 对照影响清单回归，涉及 Shell 时同时覆盖首页与工作台 |
| Kumo Adapter / 主题桥接 | 组件兼容问题优先在 Adapter 定位，区分原生控件与 Kumo 控件 | 运行对应 Adapter 用例并检查真实调用页 |

涉及 Reset、主题桥接、全局按钮、通用表格、Header / Footer 或全局弹窗层级时，PR 必须列出影响范围与回归证据。单个业务页的偶发样式问题应在所属页面处理。

## 8. 业务模块完整交付

默认一个模块使用一个 Issue 和一个 PR，可在同一任务内分步开发。除非 Issue 明确列出缩小的范围及原因，PR 必须覆盖所有实际存在的主要视图；仅修改列表页只能作为局部交付。

### 8.1 在 Issue 中填写交付矩阵

逐行填写实际入口、用户角色、适用要求和验收路径。功能不存在时记录“不适用”及依据，不为凑齐矩阵新增卡片模式、详情抽屉或统计。应验收而缺少证据的项目标为 `UNVERIFIED`。

| 页面或状态 | 范围与验收动作 |
|---|---|
| 模块入口 | 必查。由实际导航进入，核对标题、当前模块和初始视图 |
| 列表、卡片 | 分别盘点；存在则必须改造，保留原有视图切换、字段和行操作 |
| 详情 | 存在则必须改造，核对分组、返回和有权限的操作 |
| 新增、编辑 | 分别走通已有入口，改造现有表单并核对校验、保存、取消与反馈 |
| 筛选 | 存在则必须改造，核对选中、组合、清空与结果计数 |
| 排序与分页 | 存在则必须验收，检查变更条件后数据、页码与总数一致 |
| 弹窗与抽屉 | 存在则必须验收打开、确认或取消、关闭与焦点返回 |
| Loading、Empty、Error | 分别验收等待、真实空数据、加载失败及已有恢复路径；记录缺失的状态表达 |
| 权限不足 | 按实际菜单、直达入口及操作权限验收拒绝或只读表现 |
| Header、Footer | 分别回归第 4 节契约，复查短页、长页及页末操作 |
| 移动端 | 必须实际操作导航、筛选、详情与已有编辑入口，检查滚动和遮挡 |

### 8.2 一个模块从盘点到交付

1. **A · 开发前盘点**。阅读最新本文和 [UI Adapter README](src/ui/README.md)。从路由、组件和权限判断填写矩阵，记录共享组件消费者、CSS 依赖、既有业务流程、视觉参考与完整实施范围。
2. **B · 完整实施**。依矩阵完成主要视图，保留原有功能、权限和数据行为。优先复用共享能力，隔离模块样式，仅在现有能力不足时引入抽象。
3. **C · 双重验收**。按第 9 节执行技术检查与视觉对照，覆盖 Shell 和所有直接受影响的共享组件消费者。
4. **D · PR 交付**。关联 Issue，填写范围与实际改造页面、共享组件变更、CSS 影响范围、测试结果、截图或可靠视觉证据、未验证项、已知风险、CI 状态和视觉验收结论。技术检查全部通过且用户确认视觉效果后才建议合并；不得自动合并。

## 9. 技术与视觉验收

**技术验收**记录 TypeScript、ESLint、单元测试、构建、相关 Playwright E2E、业务回归及 CI 的实际结果。业务回归按矩阵走通权限、筛选、分页、编辑与保存等已有路径。

**视觉验收**单独给出结论。用实际截图对照第 4、5 节，检查标题与工具栏的主次、侧栏选中、卡片与表格密度、按钮与状态、Header / Footer、长文本、主题和页面滚动。Workspace UI PR 至少选取一个已有 Workspace，在相同视口和外观下对照侧栏轨道、主容器和 Section，检查重复背景、跨模块视觉差异，以及各自业务操作和响应式行为。即使 CI 全绿，仍须审阅截图并实际操作。移动端除检查文档宽度外，还须点开菜单、抽屉与弹窗，操作关键控件，滚至末项并检查关闭、焦点和底部按钮可达性。

### 9.1 代表性覆盖矩阵

| 维度 | 如何取样与记录 |
|---|---|
| 视口 | 推荐基线为 1920 × 1080、2560 × 1440、1440 × 900、768 × 1024、390 × 844。桌面检查 Shell 与主内容同屏，平板检查收纳或换行，手机实际展开抽屉并滚动长列表 |
| 语言 | 切换中文与英文，重点看 Header、工具栏、按钮、表头、筛选项、字段标签和弹窗。用较长文本检查截断、换行及操作区重叠；现有翻译缺口单列 |
| 主题 | 覆盖 Light、Dark、System（核对跟随系统），以及 Green / Blue / Purple / Orange 和合法 Custom（如 `#307B86`）。在同页切换绿、紫核对选中项、徽标及已有进度条同步响应；成功、失败和警告仍可辨认 |
| 密度 | 切换 Comfortable / Compact，在有显式覆盖的目录行、筛选或表单等处比较间距，注明实际生效区域 |
| 权限 | 覆盖游客、管理员及模块实际支持的其他受限角色。核对菜单数量、直达入口、可见操作与权限不足反馈 |
| 交互与数据 | 分别触发 Loading / Empty / Error、Disabled / Hover / Focus；有写入流程时验证 Saving、Success / Failure、错误后恢复与重复提交保护的实际表现 |

每个完整模块 PR 必须提供主要业务视图的桌面实图，并包括代表性移动端、深色模式截图。图片标注页面、视口、语言、主题 / Accent、密度、角色和关键状态，可由一张图覆盖多个维度。按风险分配组合，无需全量笛卡尔积；记录实际样本，未实际验证的项标为 `UNVERIFIED`。可复用与提交匹配的 Playwright 截图或 CI Artifact，在 PR 中关联证据；长期规范引用测试源码。

### 9.2 既有证据与覆盖边界

| 现有回归入口 | 已覆盖的代表性行为 |
|---|---|
| [共享 Shell](e2e/shared-shell-visual.spec.ts)、[Footer](e2e/app-footer.spec.ts) | 首页、上游、数据仓库的胶囊与页脚样式对照；首页页脚随内容滚动、工作台短页靠底和长页不遮挡、链接目标与主题可读性 |
| [Header 导航](e2e/header-navigation.spec.ts)、[移动侧栏](e2e/sidebar-shell.spec.ts) | 导航槽几何、更多菜单、游客与管理员入口、移动搜索、抽屉关闭和焦点返回 |
| [上游工作台](e2e/upstream-visual.spec.ts) | 列表与卡片、详情、新增与编辑、筛选重置、访客维护入口、侧栏滚动与摘要、代表性外观组合 |
| [外观设置](e2e/appearance-settings.spec.ts)、[Select Reset](e2e/select-reset.spec.ts) | 预设与自定义 Accent、目录行密度，以及分页和业务筛选 Select 的间距与点击 |

此表标明测试断言的范围。通过结果应追溯到对应提交的运行记录；新模块的具体页面、角色、双语文本与异常状态仍须在该模块 PR 中取证，不能继承上游的验收结论。
