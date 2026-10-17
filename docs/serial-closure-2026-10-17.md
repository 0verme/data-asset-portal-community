# 2026-10-17 串行交付与最终验收

## 仓库与授权

- remote：`https://github.com/0verme/data-asset-portal-community.git`。
- 从实时 `origin/main=4cfdc895e13403e5d7c912b9d62c1d0e0fc0c97c` 创建 `codex/serial-closure-20261017`。原本地 main 为 `133ad13`，未重置 main。
- 初始与交付时均保留用户未跟踪的 `miniapp/project.private.config.json`，未读取其内容、未提交。没有清理、重置、覆盖其他 worktree。
- 读取根 AGENTS.md、frontend/DESIGN.md、commit-message-writer；只做本地实现、测试和分切片提交，没有 push、PR 创建/评论、合并、Issue 关闭、Tag/Release、部署或业务库写入。
- 实时开放总控仍为 #414/#406/#403/#314/#313/#421（另有不属本任务的 #252）；开放 PR 为依赖更新 #432/#433/#434。没有重复实现已合并 #418/#423/#424–#431。

## 按切片留存的 HEAD 与结果

下表每个 SHA 都可直接恢复/审阅。完整 SHA 以本地 Git 对象为准，短 SHA 无歧义。

| Issue | 提交 HEAD | 实现与对应验收 |
|---|---|---|
| #414 | `89d43e4` | 发布构建必须显式 remote，未知值拒绝；开发 Mock 保留。模式单测 2/2，实际 mock/拼错构建拒绝，remote 构建成功；CI 构建显式 remote |
| #414 | `0e809e0` | 门户统计失败不返回假零、不返回无标识的过期缓存、不缓存失败；HTTP 503 安全文案。后端定向 33/33 |
| #414/#403 邻接 | `b03d8d0` | 字段映射/指标异常列表 envelope 拒绝；来源选项失败独立提示/重试。定向单测 7/7，既有渐进加载双引擎 10/10，选项失败重试双引擎 2/2 |
| #406 | `4d82246` | 保存当前选择的 canonical systemId、保留搜索中的当前选项；required/example 编辑；HEAD/OPTIONS；重复子项报结构化行号错误。前端定向 9/9、后端 6/6、Remote 双引擎 6/6 |
| #403 | `c9bd134` | 非生产 loopback HTTP 测量工具与执行方案；只 GET、输出聚合计数/耗时，拒绝远端与重定向。工具隔离测试 2/2、help/compile 通过；真实性能 NOT RUN |
| #314 | `6d469cd` | DWS 前置证据、四份文档收口范围、Windows/Linux 应用验收和恢复点；核对源文件与真实验证记录，未运行 DWS |
| #421 | `fe65c6d` | 原样 cherry-pick 用户指定的 `b37eb5c`，只修 Windows 路径分隔符。原 worktree 保留；全量单测随后通过 |
| #414/#406 测试 | `512ffd3` | 更新已有 adapter 控件清单：新 required/example/retry 控件仍必须走 adapter；未放松禁止 deep-import 的边界。全量 316/316 + 模式 2/2 |
| #421 | `913f3e9` | 记录受控 Dialog 打开前焦点/指针触发元素，接入 primitive finalFocus；嵌套与 busy 契约测试。Overlay 双引擎 22/22；焦点并发重复 8/8；lint/typecheck/build 通过 |
| #414 | `d2a6f24` | 损坏/形状错误的报表关联及血缘 JSON 明确报错，合法 nullable/空集合保留。后端 JSON/报表/血缘定向 19/19 |
| #414 | `ede6c50` | 搜索保留成功组并返回 partial/failedGroups；全部失败返回错误；前端提示不完整，零个成功命中不宣称全站无匹配。搜索与相邻契约 43/43，新增公开投影契约通过，Remote 用户流程双引擎 2/2 |
| #406 | `959d6b0` | 保存中防重复并禁用保存/取消；未知状态原样提示并要求明确选择。全量单测 316+2、lint/typecheck、Remote 双引擎 6/6 |
| #406 | `5b0787d` | 主表既有文本列长度前后端校验，结构化 max_length、说明/备注 ARIA 与首错定位；显式声明自由文本 type。后端 7/7、前端定向 7/7、超长保留输入双引擎 2/2、全量单测 317+2、lint/typecheck/build |
| CI | `92b8ddf` | Remote API/数据可信性/选项失败与 Mock presenter/overlay 分组运行；YAML 解析及模式隔离断言通过。未运行远端 Actions |
| #421 | `951fab1` | 报表双视口独立用例，完整 presenter 分组默认 30 秒、双引擎、2 workers 为 20/20 |
| #403 | `3ee0541` | loopback 测量禁用环境代理；稳定计数标为 stable_counts，不将其夸大为快照稳定证明。工具测试 2/2 |

## 验证环境与命令

环境为 Windows、Node 24.15.0、项目 backend/.venv。Chromium 与 Playwright WebKit 是真实运行的测试引擎，但 WebKit **不是 macOS/Safari 或屏幕阅读器验收**。浏览器 API 由 route fixtures 拦截，属于模拟 HTTP 合约；后端测试使用 mocks、SQL 编译与隔离 SQLite，不是生产或真实 DWS。

- `npm test`：最终 317/317，API Mode 测试另 2/2。
- `npm run typecheck`（含三个 lineage workspace）、`npm run lint`、`VITE_API_MODE=remote npm run build` 均通过；后续改动又运行 app typecheck/lint/frontend build。构建仅有既存 >500kB chunk 提示。
- 后端汇总：`python -m unittest` 的 portal registry、FastAPI infrastructure、profile schema SQL、search visibility/partial/asset/registry、persisted JSON、report CRUD、lineage core/persistent、API CRUD、HTTP measurement 共 81/81（新增长度切片前）；随后 API CRUD 7/7 验证新增长度边界。不是全后端测试套件。
- 最终读取权限/审计边界回归：authenticated read model、public catalog profiles、actor audit consistency、RBAC route enforcement 共 26/26，通过当前 ContractModel 与公开投影路径。
- `python demo/validate_demo_data.py --strict`：342 文件，BLOCKER=0、SUSPICIOUS=0。未改 Public Data Guard 策略、Community/Private 边界或权限。
- `npm run test:browser -- e2e/kumo-overlays.spec.ts --workers=2`：22/22；`--grep 'DAP Dialog shares|controlled Dialog restores' --workers=2 --repeat-each=2`：8/8。
- Mock 模式 `admin.spec.ts root-code-table.spec.ts api-asset.spec.ts --grep-invert 'API asset validation' --workers=2`：24/24，保持全局默认 30 秒。
- 最终 CI 等价 Remote 分组 12/12、Mock presenter 20/20（下方留存执行信息）。
- 每次提交检查 status、diff stat、完整任务 diff、cached diff、diff check；显式 stage 本切片路径。凭据检查限于拟提交内容；没有读取用户 Token 或生产连接配置。

### 失败定位与性能边界

- 原主线 WebKit 在 `kumo-overlays.spec.ts` 关闭 Dialog 后未返回触发按钮，稳定复现原 :50 inactive；修复后验证指针、键盘、嵌套与焦点陷阱。
- 900ms fixture 自动结束与 busy 断言竞态：改成测试可显式完成的 pending 操作；拆分独立流程但保留所有关键字、busy、Escape、outside click、成功/取消、Toast/queue 步骤，并新增 busy outside click 断言。
- Windows WebKit 并发下两个完整焦点流程曾测得 30.8/32.2 秒。撤回临时预算后默认 30 秒重复复测为 7/8，1 项超时；这不是焦点断言失败。最终仅这两条保留 60 秒预算，全局仍 30 秒；最终并发重复 8/8，完整 Overlay 22/22。默认 30 秒的 Windows 压力稳定性未宣称通过，仍应后续跟踪。
- 最终 presenter 首轮 17/18；报表反向失效日期测试在同一用例里串行执行两个视口，在第二轮累计达到 31.6 秒。将两个视口参数化为独立用例，保留每轮全部填表、折叠、保存、展开、focus/ARIA/摘要/未关闭断言；保持默认 30 秒，不强制点击或删步骤。
- 新增 API/数据可信性测试曾因 fixture 拦截了 Vite 源文件、定位器漏掉标题冒号、或错误地期待搜索后仍显示首页统计而失败。均据快照/请求修正测试设置；未降低业务断言、强制点击或删减产品流程。

## #414 风险矩阵重核

| 风险 | 本轮状态与边界 |
|---|---|
| MODE-01 | IMPLEMENTED_LOCAL：发布 remote 门禁、开发 Mock、未知值拒绝 |
| PORTAL-01 | IMPLEMENTED_LOCAL：当前缓存 TTL 内正常值继续可用；失败 503；过期缓存不再冒充当前值，未新增 stale 展示协议 |
| FM-01 | MERGED：#418；不重复放宽全局 fieldCount 投影 |
| 字段渐进加载 | MERGED：#423；不重复实现 |
| SEARCH-01 | IMPLEMENTED_LOCAL：partial/failedGroups，成功分组保留、总数明确为已加载；全部失败为错误 |
| FM-OPTIONS-01 | IMPLEMENTED_LOCAL：失败可见、独立重试 |
| SHAPE-01 | IMPLEMENTED_LOCAL：Issue 点名的 fieldMapping/indicator envelope 路径拒绝未知形状；未宣称已治理所有 API normalizer |
| JSON-DATA-01 | IMPLEMENTED_LOCAL：Issue 点名的 report/lineage JSON 解码路径；未扫描业务库，不宣称存在坏数据或频率 |
| DICT-01 | WAITING_DECISION：上下游部门、报表候选仍可能混入静态值；后端类别缺失/数据源失败 fallback 仍在。reportOptions 的注释不能当作实际 Mock 模式隔离证据，函数未读模式开关 |
| PROFILE-01 | WAITING_DECISION：ASSET_DB_* 全局 override 是已有文档/测试契约，未擅改，不断言已错连 |
| POC-01 | WAITING_DECISION：dev/test 的显式标注 POC 保留；生产缺 profile 仍 fail closed |

总控验收：生产模式、上述错误/形状/JSON 软件子项已有本地证据；业务字典策略、profile/POC 决策与真实部署验证尚缺。#414 不可关闭。

## #406 决策表与完整验收边界

| 待决事实 | 必需输入 | 决策前保留的行为 |
|---|---|---|
| API type | 获授权的历史值、大小写/别名、canonical code/label 与扩展规则 | 自由文本、未知字符串保留，不把 query/command Demo 升格为枚举，不按 method 改写 |
| 部门/负责人/维护人 | 权威组织/员工目录、稳定身份、重名、停用/离职/删除策略 | 继续名称字符串；不用登录账号替代员工，不绑定 UPSTREAM_DEPT，不新增组织平台 |
| 停用/删除/未知调用系统 | 是否允许原关系只改普通字段，或必须重绑；旧值的显示与审计规则 | 仍采用既有“新写入必须 enabled”校验；当前停用项可回显、可改绑 enabled，不默默放行停用关联 |
| path / method / 参数组合 | path 占位符、GET body 等业务规则是否允许历史例外 | 不凭 HTTP method 推断业务含义；HEAD/OPTIONS 安全回显，未知 dataType 保留 |
| 参数排序/详情完整展示 | 是否需要重排控件、详情展示哪些契约属性 | 不增 DB 列；现有数组顺序与其他关系保留，不擅增功能 |

已验：关联 canonical ID、搜索不丢当前值、disabled 回显/重绑、必填与示例编辑、重复参数/响应/关联拒绝、主表长度、本地首错/ARIA、422 重试保留、保存 pending、未知状态提示、历史 type/dataType 保留。#420 已交付的基础校验不重复重写。

未验/剩余：真实数据库 CRUD 与跨方言运行；生产历史数据；子表全部长度/组合业务约束；完整详情展示/重排需求；SystemPicker compound Kumo 迁移取决于停用选择策略，当前保留有浏览器证据的原生 select；Dark/Light 全表单视觉与真实屏幕阅读器。因此 #406 总控保持开放。

## #403 / #314

- #403：Phase 1 MERGED；测量工具 IMPLEMENTED_LOCAL。代表性数据、独立 COUNT/列表/筛选成本、真实首屏和稳定快照统计一致性为 WAITING_ENV。执行 [测量方案](field-mapping-measurement.md) 后才决定 Phase 2 查询优化，再决定 Phase 3 缓存；未建索引、未宣称百万级实测。
- #314：WAITING_ENV。#313 的 REAL_DWS_VALIDATION 所有真实场景仍 NOT RUN。只交付 [部署前置清单](dws-deployment-readiness.md)，未把四份最终部署文档标为收口，未运行 apply/seed/create_admin。真实恢复目标确认后才按 #313 清单继续。

## #421 逐模块差距

| 模块 | 当前证据 | 真正剩余 |
|---|---|---|
| 公共 normalizer/notification/presenter | #424/#425/#426 MERGED；当前全量单测及 overlay 回归 | 真实读屏、全站 401/403/409/422/500 去重、实际生产生命周期 |
| 报表/指标/表编辑/词根/推送 Job | #427–#431 相应 FormField/FormErrorSummary 已在主线；本轮不是重写 | 各模块真实 API、屏幕阅读器、390px/fixed bar 全验收；不凭合并即标 Phase 5 完成 |
| 上游编辑 | UpstreamEditor 有字段 ARIA/本地与服务端错误路径 | 与共享摘要、清错、读屏和长表单流程逐项对照，未宣称本轮完整浏览器验收 |
| 系统用户 | UserForm 仍以 ActionErrorBanner + invalid class 为主；hook 可保留 details | 逐字段 inline/aria-invalid/describedby、可定位摘要、首错聚焦、按字段清错 |
| 系统菜单/参数 | MenuForm/ParamForm 仍以 banner + invalid class 为主；保存错误部分回到 form 级 | 结构化 server 字段映射、inline/ARIA、首错/清错、失败保留流程 |
| 系统角色 | RoleManagementPage 有 errors/banner 与字段 class | 同上，不能把已有 error 数组当作完成字段关联 |
| 手工码值表 | ManualCodeTablePage/hook 保存失败保留 errors 与表单，样式标红 | inline/ARIA、摘要定位、首错与按字段清错；本轮 adapter 流程不等于错误验收 |
| API 表单 | #420 加本轮 #406：字段/行错误、ARIA、首错、保存门禁和保留输入有局部证据 | 汇总可点击定位、全部子列错误关联、真实 API/读屏；不机械重写为新框架 |
| 下游 SystemEditor | latestOutputTime 有局部 ARIA，其他字段仍各自校验 | 全字段错误契约/结构化关联、首错与清错，不强塞通用卡片组件 |
| Overlay/移动通知 | 本轮 WebKit 焦点修复、嵌套/busy、390px 通知位置、队列/关闭回归 | 真正 macOS/Safari、NVDA/VoiceOver 与 Windows 默认 30 秒压力稳定性 |

上述软件项是已确认的未完成范围，不伪装成 WAITING_ENV；#421 总控只要求本轮核对并修复指定焦点问题，未将其 Phase 4/5 全部宣称完成。

## 最终状态与续接

- 本轮代码：IMPLEMENTED_LOCAL；测试引擎/隔离测试流程有 RUNTIME_VERIFIED 证据，**真实业务环境没有**。
- MERGED 只用于已在输入 main 的历史 PR；本轮所有提交未 MERGED、未 DEPLOYED。所有总控保持 OPEN。
- 待批准远端动作仅为 push 本任务分支、创建供审阅的 PR；合并/部署需各自明确授权与相应 gate，不能因本地绿灯关闭 Issue。
- 唯一下一步：维护者先确认上方决策表中的权威来源与停用关联规则（优先 #414 DICT-01 / #406），即可沿本分支继续下一条字典隔离/选择器切片；不需要等待 merge，也不能把生产凭据发到仓库。#403/#314 的环境清单可独立准备。

### 最终核验

代码/测试记录截至 `3ee0541`，输入远端 main 再核验仍为 `4cfdc895e13403e5d7c912b9d62c1d0e0fc0c97c`。

- Remote：`VITE_API_MODE=remote npm run test:browser -- --grep 'API asset validation|Remote data trust|source options failure' --workers=2`：12/12，50.9 秒。HTTP 为 fixtures，不是真实后端。
- Mock：`VITE_API_MODE=mock npm run test:browser -- --grep 'form error presenter' --workers=2`：20/20，2.3 分钟，保持默认 30 秒；报表两个独立视口 WebKit 分别 22.5/11.9 秒，全部断言保留。
- 截图/trace 输出保存在仓库外 `E:/vbcoding/dap-serial-test/` 的分组目录，失败留存供诊断；成功项以本记录与实际命令结果为证，不宣称有真实业务数据录像。
- 报告同时更新发布构建示例，明确 remote 环境变量；这不是 #314 最终 migration 文档收口。
- 提交前再次检查 status、diff stat、完整 diff 与本地链接；不提交原小程序私有配置。报告提交的最终 SHA 见 Git 与交付回复。
