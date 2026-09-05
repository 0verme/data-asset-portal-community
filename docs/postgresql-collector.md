# PostgreSQL Collector · 10 分钟导入真实资产

DAP 的官方 metadata source collector 目前只有 **PostgreSQL MVP**。它是仓库内的外部参考实现，不是 DAP Core 的内部数据库适配器：

```text
PostgreSQL
    ↓ 只读 catalog 查询
Official PostgreSQL Collector
    ↓ Metadata Ingestion Contract 1.0
POST /api/metadata/assets/ingestions
    ↓
DAP Service → Database Provider → DAP UI
```

Collector 不 import DAP 的 repository、service、provider 或数据库表，也不直接写 DAP 数据库。

## 1. 前置条件

- 已启动 DAP，并知道 DAP 的 base URL；本地 Community Demo 默认是 `http://127.0.0.1:15099`；
- Python 3.10+；
- 已安装仓库后端依赖（其中包含 `psycopg` 与 `PyYAML`）：

```bash
pip install -r backend/requirements.txt
```

Collector 的 POST API 受 DAP 的 authentication / `metadata:write` permission 保护。可以使用一个有该权限的 DAP 用户，或者在本地 Demo 中使用 Demo 管理员；生产环境不要长期使用 Demo 凭据。

## 2. 创建 PostgreSQL metadata readonly 用户

Collector 只读 `pg_catalog` 元数据，不读取业务表行、不执行 `SELECT *`、`count(*)`、sample rows 或 profiling，也不会创建、修改、删除 PostgreSQL 对象。请按目标数据库和组织权限规范创建专用账号，例如：

```sql
CREATE ROLE dap_reader LOGIN PASSWORD '<store-outside-git>';
GRANT CONNECT ON DATABASE warehouse TO dap_reader;
GRANT USAGE ON SCHEMA dwm, dwd, dm TO dap_reader;
-- No SELECT on business tables is required by this collector.
ALTER ROLE dap_reader SET default_transaction_read_only = on;
```

将 `warehouse`、schema 和密码替换为实际值。Collector 自己也会以 `default_transaction_read_only=on` 和 statement timeout 建立连接；上面的角色级设置是额外的防护。不要把真实密码写入仓库或提交到配置文件。

## 3. 配置 Collector

复制公开模板并按实际环境修改。模板可以提交到团队配置仓库，因为它只包含 topology 和环境变量名，不包含密码：

```bash
cp examples/metadata_ingestion/postgresql.yml ./postgresql.yml
```

至少修改 `source.host`、`source.port`、`source.database`、`source.username` 和 `source.schemas.include`。不填写 `schemas.include` 时扫描所有非系统 schema。

```yaml
source:
  type: postgresql
  name: warehouse-prod
  namespace: finance
  host: 127.0.0.1
  port: 5432
  database: warehouse
  username: dap_reader
  password_env: DAP_PG_PASSWORD
  schemas:
    include:
      - dwm
      - dwd
      - dm

sink:
  url: http://127.0.0.1:15099
  session_cookie_env: DAP_SESSION_COOKIE
```

PostgreSQL 密码必须通过环境变量提供：

```bash
export DAP_PG_PASSWORD='<postgres-readonly-password>'
```

DAP sink 有两种认证方式，二选一：

1. 将已登录 DAP session 的 `session` cookie 原始值放入 `DAP_SESSION_COOKIE`；或
2. 在配置中增加 `username_env` / `password_env`，Collector 会调用现有 `/api/auth/login` 获取短期 session，密码仍只从环境变量读取：

```yaml
sink:
  url: http://127.0.0.1:15099
  username_env: DAP_DAP_USERNAME
  password_env: DAP_DAP_PASSWORD
```

```bash
export DAP_DAP_USERNAME='<dap-maintainer-username>'
read -r -s DAP_DAP_PASSWORD
export DAP_DAP_PASSWORD
```

Collector 不会打印 PostgreSQL 密码、DAP 密码、session cookie 或 token。跨主机部署时应使用 HTTPS；本地 Demo 的 HTTP 只适合本机体验。

## 4. check / preview / sync

从仓库根目录执行：

```bash
python examples/metadata_ingestion/postgresql_collector.py \
  check -c ./postgresql.yml

python examples/metadata_ingestion/postgresql_collector.py \
  preview -c ./postgresql.yml

python examples/metadata_ingestion/postgresql_collector.py \
  sync -c ./postgresql.yml
```

`check` 验证 PostgreSQL 连接和 DAP `/healthz`；`preview` 扫描 catalog 并输出 schema/table/column 数量及受限的 payload 摘要，不调用写入 API；`sync` 才会 POST 到现有 Metadata API。重复执行 `sync` 复用 Contract 的 source-scoped natural key，DAP 会返回 `unchanged`，不会无脑创建重复资产。

常见错误会标明阶段，例如：

```text
Configuration error: ...
PostgreSQL connection failed: ...
Metadata scan failed: ...
DAP connection failed: ...
Metadata contract validation failed: ...
Metadata sync failed: ...
```

需要排查 traceback 时可以在命令末尾添加 `--debug`；输出仍会做凭据脱敏。

## 5. 当前采集边界

| Metadata | 状态 | 说明 |
| --- | --- | --- |
| schema name | **SUPPORTED** | 默认排除 `pg_catalog`、`information_schema`、临时/toast 系统 schema；支持 include filter |
| table name / identity | **SUPPORTED** | `schema.table` 作为稳定 `externalId` / `qualifiedName` |
| table relation type | **SUPPORTED** | `table`、`partitioned_table`、`view`、`materialized_view`、`foreign_table` 映射到现有 Contract 的 `assetType` |
| table comment | **SUPPORTED** | `obj_description` 映射到 Contract 的 `description` |
| column name / ordinal | **SUPPORTED** | 使用 PostgreSQL `pg_attribute` |
| PostgreSQL data type | **SUPPORTED** | 使用 `format_type`，保留长度、precision/scale、timestamp、array 和 user-defined type 表示 |
| nullable | **SUPPORTED** | 读取 `attnotnull` |
| primary key | **SUPPORTED** | 读取 `pg_index` |
| column comment | **SUPPORTED** | `col_description` 映射到 field `description` |
| column default | **PARTIAL** | catalog 查询可读取 `pg_get_expr`，但当前 Metadata Contract / DAP asset field storage 没有 default-value 字段，因此本 MVP 不写入 payload |
| owner | **NOT IMPLEMENTED** | 当前 Contract 没有稳定的 owner 字段 |
| 完整 PostgreSQL DDL | **NOT IMPLEMENTED** | PostgreSQL 没有简单稳定的 `SHOW CREATE TABLE` 等价；本期不引入 dump/parser，也不伪造完整 DDL |

### 关于原始类型

Collector 尽量把 PostgreSQL `format_type()` 的结果原样放入 `dataType`。DAP Service 仍会按现有 Contract 规则做内部展示归一化；Collector 不实现一个会丢失 PostgreSQL 类型细节的“大而全类型转换器”。

## 6. DAP Runtime DB 与 Metadata Collector 的区别

这两个支持矩阵不能混淆：

| 范围 | 当前支持 |
| --- | --- |
| DAP Runtime DB | SQLite、PostgreSQL、MySQL 8.0；GaussDB/DWS 为 Compatible（以仓库支持矩阵为准） |
| Official Metadata Collector | PostgreSQL（MVP） |

Runtime DB 支持 MySQL 不代表本仓库已经提供 MySQL metadata collector。Hive、Doris、Oracle、DWS 和 MySQL Collector 均不在本期范围内。

## 7. 失败处理与安全边界

- source 连接认证失败、连接超时和 catalog 查询失败会分别在 PostgreSQL connection / metadata scan 阶段报告；
- DAP 不可达、401/403、4xx、422、5xx 和 timeout 不会只打印裸 traceback；
- 4xx/422 通过现有 Contract 错误响应反馈，不创建第二套 ingestion protocol；
- `preview` 不发送 session cookie，不输出密码/token；
- Collector 不访问 DAP 内部数据库，不调用 DAP Service/Provider；
- Collector 没有 scheduler、retry loop、profiling、lineage parser 或业务数据读取能力。

完整的 Contract 字段、版本、幂等和审计语义见 [Metadata Ingestion Contract](./metadata-ingestion.md)。
