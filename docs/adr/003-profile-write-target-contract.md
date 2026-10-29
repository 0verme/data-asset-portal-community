# ADR-003：Profile 应用写目标与 Schema 解析契约

- Status: **Phase 1 已合并；PostgreSQL baseline target consistency 已实现待评审；真实部署兼容仍未验证**
- Scope: Issue #454，SC-01..SC-07
- Baseline: `f4cc555c8773d83736e1c3f8d6de5264baf1c2e7`
- Boundary: 不改变 #414 的 profile 覆盖优先级，不接管 #313/#314 migration 与部署验收。

## 1. 唯一应用目标

一次写操作使用按现有 `get_db_profile()` 规则解析完成的最终有效 Profile（包括现有 defaults 与环境覆盖），并固定一个 application target。Profile 选择与配置覆盖行为不在本 ADR 改动范围内。

| Provider | application target | 写入要求 |
| --- | --- | --- |
| SQLite | 显式 database 文件 + 固定内部 attachment alias `dwp` | 文件缺失/不明确时拒绝；`dwp` 是 SQLite 连接内部合法别名，不是部署 schema。不得把它改成 `dap`。 |
| PostgreSQL | 显式 `schema` | 新写入要求非空且合法；未配置时 fail closed。既有 provider 的 `dwp` 物理 fallback 不是写入授权。显式 `schema: dwp` 仍是受支持目标；不从 `search_path`、用户或 DSN 猜测目标。PG 的配置与原生 SQL 标识符按未引用标识符语义折为小写，Core engine/raw 编译必须使用相同解析结果；大小写敏感的引用标识符不自动视为同一目标。 |
| MySQL | Profile 的显式 `database`；physical schema 为空是合法方言映射 | 缺 database 时拒绝。SQL 中显式 `database.table` 仅当 database 与该 Profile 目标一致时可用；历史 `dwp.table` 不会被去前缀或改写，只有目标 database 明确为 `dwp` 时才可能匹配。 |
| GaussDB/DWS | 显式合法 `profile.schema` | 真正执行写入的 JDBC 会话 `current_schema()` 必须与 Profile schema 一致；缺失、冲突、歧义或无法验证均在第一条 DML/DDL 前拒绝。不得改写 JDBC URL、静默 `setSchema()` 或继续写入。 |

显式的 `dwp` 是兼容目标，不是对其他目标的别名。Profile 目标为 `dap` 时，显式 `dwp.*` 应拒绝而不是替换成 `dap.*`。旧 PG 配置依赖隐式 `dwp` fallback 的真实部署分布目前 **NOT VERIFIED**；本规则选择用户授权的安全默认（新写 fail closed），不承诺无配置变更的兼容。若要为特定存量部署保留隐式目标，须先有部署证据及单独批准的、明确启用且可测试的兼容机制；不得由实现者猜测。

## 2. SQL 入口与授权边界

- **Core Table**：应用 metadata 的逻辑 `__app__` 仅通过 provider 的结构化 schema translation 解析。应用表若显式带物理 schema，必须等于当前 target；不得因表名像 `p_*` 就推断任意外部表归属。
- **TextClause**：`schema_translate_map` 本身不解析 `text()` 内容。它必须经过与 facade raw SQL 一致的目标检查；仅支持可无歧义识别的安全形式，其他写入拒绝。不得把字符串/注释/引用标识符中的内容当 schema token。
- **raw SQL / str / tuple / execute_many / executemany**：等价语句形状必须进入同一预检。批次先解析完整批次，再执行第一条写语句；目标错误时不得先执行部分 DML/DDL。参数保持独立 bind，不参加 SQL 文本替换。
- **caller-owned cursor**：Core 编译到显式合法目标时可经受控 cursor adapter 执行；如目标或会话无法从受控连接验证，拒绝不受控 raw 写入。事务所有权不能代替目标授权。
- **跨 Schema**：普通应用写入只能写当前 Profile target。来源 Schema 的只读访问、迁移 infrastructure 及 SQLite attachment 属于各自显式边界；它们不扩大普通 facade 的写权限。其他跨 Schema 写需要窄范围、逐对象/操作授权的独立能力，不提供通用放行开关。

目标检查不得依赖扩大 `str.replace()` 或“连接账号碰巧有权限”。校验失败应在任何业务 DML/DDL 前发生；事务、rollback 或 Fake 成功都不能证明真实目标正确。

## 3. Baseline 与既有迁移边界

- PostgreSQL canonical `backend/schema/postgresql.sql` 保留逻辑 `dwp`；fresh initialization 只消费显式、已校验的 Profile schema。profile renderer 仅改写 schema identifier token（包括 `CREATE SCHEMA IF NOT EXISTS dwp` 的目标），将 DDL 指向该 schema，并保留 canonical baseline 当前的 `CREATE SCHEMA IF NOT EXISTS` 行为。
- PostgreSQL migration 的 ledger lookup/stamp、user-table preflight、reflection 与 baseline DDL 都使用同一规范化 Profile schema；目标缺失时在查询/DDL 前 fail closed，不使用 `physical_schema()` 的 `dwp` fallback。非 `dwp` 目标由 Recording/offline regression 覆盖；真实部署兼容仍 NOT VERIFIED。renderer 不改写业务默认值、字符串、注释、引用值，也不修改 canonical SQL 或已发布 Alembic revisions.
- DWS 继续使用既有 profile-aware baseline、schema existence guard、逐语句失败与相同 schema ledger/reflection，仍要求部署方预先创建目标 schema；#313 已合并实现和未完成的真实 DWS 8.1.3 验收均不由本 ADR 重做或代替。不得改写历史 Alembic revision。

## 4. 必须保留的合法 Schema 值

`SQLite dwp` attachment 与 `PRAGMA dwp.*`、canonical/logical migration namespace、资产记录中的外部 `schema_name`、来源目录/Owner schema、已定义测试 fixture 和明确的 reference-only SQL 均不是可全局替换的应用目标硬编码。Schema 搜索或词法扫描不能单独作为批量改写依据。

## 5. Phase 0/后续回归契约

自动化用例至少比较实际 Recording cursor 的 SQL、bind、调用顺序、commit/rollback，而不只检查最终 SQL 字符串包含关系：

1. 正确显式目标可写；缺失、冲突、歧义、错误 Schema 在首个写之前拒绝。
2. Core Table、TextClause、raw string、`(sql, params)`、batch 与受控 caller cursor 的行为一致。
3. 完整 batch 在第一条 DML/DDL 前预检；中途 driver 失败不 commit、不执行后续语句、不隐藏原错误。
4. SQLite `dwp` attachment、MySQL `schema=''` 当前 database、PG 显式 `dwp`、外部来源 Schema、迁移逻辑 Schema 与 fixture 保持各自既有角色。
5. `dwp.*`、`__app__.*` 出现在字符串、注释、quoted identifier、美元引用与 bind 值中时不得被误当目标 token；只允许受控且词法明确的标识符处理。
6. MySQL 空物理 schema 与显式 `dwp.table` 分别覆盖目标 database 相同/不同；不得将不匹配的历史前缀静默去掉。
7. PG fresh baseline 的 DDL、ledger 与 reflection 目标一致；不匹配目标为零 DDL。
8. GaussDB/DWS Recording/Fake 覆盖 Profile schema、JDBC current schema 匹配/冲突/缺失/未知；真实 GaussDB/DWS 的驱动、会话与 rollback 仍必须单独实测，Fake 不得代替。

DATA-NULL、DATA-CODE、业务字段规则、真实存量数据搬迁，以及修改 #414 配置优先级均不在此契约内。
