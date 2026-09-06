# Metadata API 最小资产导入 Demo

这是一条**文件 → HTTP API** 的最小导入路径。它假设你已经从现有数据治理平台、
`lakehouse-toolkit`、ETL 平台或自定义程序得到整理好的资产 JSON；Demo 不连接任何源
数据库，也不负责发现、筛选或解析资产。

```text
External System
    ↓
curated metadata
    ↓
DAP Metadata Contract
    ↓
Metadata API
    ↓
DAP
```

> `DAP = metadata consumer / asset portal`，不是 database crawler、lineage parser 或
> ingestion platform。DAP 不主动扫描数据库、不解析 SQL、不计算血缘，也不承担数据生产或
> 离线计算能力。

## 1. 当前 Contract 与示例数据

本 Demo 严格使用仓库现有的 `contractVersion: "1.0"`，canonical Contract 文档是：

- [Metadata Ingestion Contract](../../docs/metadata-ingestion.md)
- [ADR-001](../../docs/adr/001-metadata-ingestion-contract.md)
- [API Contract §13](../../docs/api-contract.md#13-metadata-ingestion-contract)

示例文件为 [`assets.example.json`](./assets.example.json)，包含 1 个 source、3 张表和
12 个字段：

- `customer_info`：客户基础信息主题表；
- `account_info`：账户基础信息主题表；
- `customer_asset_summary`：客户资产汇总主题表。

资产自然键使用 `source identity + assetType + externalId`。请为自己的资产提供稳定的
`externalId`；同一 source 下重复导入相同内容会得到 `unchanged`，内容变化会得到
`update`，首次导入会得到 `create`。

Contract 的顶层数据形状是：

```json
{
  "contractVersion": "1.0",
  "source": {"type": "...", "name": "..."},
  "collector": {"name": "...", "version": "..."},
  "assets": [
    {
      "externalId": "...",
      "qualifiedName": "...",
      "assetType": "table",
      "schema": "...",
      "name": "...",
      "description": "...",
      "fields": [
        {
          "name": "...",
          "dataType": "...",
          "nullable": true,
          "primaryKey": false,
          "ordinalPosition": 1,
          "description": "..."
        }
      ]
    }
  ]
}
```

`collector` 是现有 Contract 中“产生这份 payload 的程序”字段，不代表 DAP 提供
Collector framework。字段语义、可选字段、大小限制和错误模型以 canonical 文档为准；
Demo 的本地检查只是尽早发现明显输入错误，DAP API 仍是最终校验方。

## 2. 认证

资产 ingestion 需要已认证且具有 `metadata:write` 权限的 session。脚本优先读取：

```bash
export DAP_SESSION='session cookie value'
```

也可以不准备 session，让脚本使用现有登录接口换取 session：

```bash
export DAP_USERNAME='your-user'
export DAP_PASSWORD='your-password'
```

脚本只把凭据用于 `POST /api/auth/login`，不会把密码、session 或 token 写入 payload、
preview、成功输出或错误信息。为兼容仓库中已有脚本，也接受 `DAP_SESSION_COOKIE` 作为
session 的备用环境变量。

Community Demo 可以使用 `admin / 12346` 做本地体验，但这只是本地 Community Demo
凭据，不能作为生产环境默认账号。生产环境请使用独立账号和安全的 secret 管理方式。

## 3. 运行 Demo

从仓库根目录执行。`--dap-url` 可以写 DAP 根地址，也可以写完整的资产 ingestion URL。

### 先 preview（不发请求）

```bash
python3 examples/metadata_ingestion/ingest_assets.py \
  --file examples/metadata_ingestion/assets.example.json \
  --dap-url http://127.0.0.1:15099 \
  preview
```

`preview` 只读取 JSON、做基本 Contract 检查并打印脱敏后的 payload，**不会登录、不会
发送 HTTP 请求，也不会修改 DAP**。

### 正式 sync

```bash
DAP_USERNAME=admin DAP_PASSWORD=12346 \
python3 examples/metadata_ingestion/ingest_assets.py \
  --file examples/metadata_ingestion/assets.example.json \
  --dap-url http://127.0.0.1:15099 \
  sync
```

生产环境不要把密码硬编码到脚本或配置文件；上面的账号密码只适用于本地 Community
Demo。正式 sync 调用：

```text
POST /api/metadata/assets/ingestions
Content-Type: application/json
Cookie: session=<signed session>
```

正常导入返回 HTTP `201`，输出服务端的 `status` 和 `summary`。DAP 已有的
`dryRun=true` / `mode=preview` API 预览会返回 HTTP `200`；本脚本的 `preview` 则特意
保持为本地预览，便于在没有 DAP 服务时检查文件。

## 4. 最原始的 curl / HTTP 示例

下面的示例使用当前实现的登录接口和 session cookie，不创建第二套认证协议。凭据从
环境变量读取，命令不会把实际值写进仓库：

```bash
export DAP_URL='http://127.0.0.1:15099'
export DAP_USERNAME='admin'
export DAP_PASSWORD='12346' # 仅用于本地 Community Demo
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

printf '{"username":"%s","password":"%s"}\n' "$DAP_USERNAME" "$DAP_PASSWORD" |
  curl -fsS -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "$DAP_URL/api/auth/login"

# API dry-run：校验、比较，但不写业务数据或 audit。
curl -fsS -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data-binary @examples/metadata_ingestion/assets.example.json \
  "$DAP_URL/api/metadata/assets/ingestions?dryRun=true"

# 正式导入：去掉 dryRun=true。
curl -fsS -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data-binary @examples/metadata_ingestion/assets.example.json \
  "$DAP_URL/api/metadata/assets/ingestions"
```

如果已有 `DAP_SESSION`，也可以跳过登录，直接把它作为 `Cookie: session=...` 发送。
不要把真实 cookie、密码或 token 粘贴到 Issue、日志或截图中。

## 5. 成功后查看与排错

1. 打开 DAP 前端的数据仓库页面：`http://127.0.0.1:15099/data-warehouse`（按你的部署
   地址替换），搜索 `customer_info`、`account_info` 或
   `customer_asset_summary`；
2. API 响应中的 `summary` 会区分 `create`、`update`、`unchanged`、`conflict`、
   `invalid` 和 `deleteCandidate`；
3. 正式 ingestion 返回 `ingestionId`，可用有权限的请求查询：

   ```text
   GET /api/metadata/ingestions/{ingestionId}
   ```

常见问题：

| 现象 | 含义 |
| --- | --- |
| `JSON 解析失败` | 输入文件不是合法 JSON；修复文件后重新 preview |
| `Contract 校验失败` | 缺少当前 Contract 所需的字段或字段类型不对；以服务端 `422` 为准 |
| `401` / `403` | 未登录、session 失效或没有 `metadata:write` 权限 |
| `413` | 超过当前 API 的 body / bulk 限制 |
| `409` | 当前语义冲突（例如重复的自然键或其他 Contract 冲突） |
| `5xx` 或“不可达” | DAP 服务、网络或部署依赖异常；脚本不会重试或改写输入 |

同一请求中出现重复 natural key 会被 DAP 拒绝；正式写入由 DAP 在一个事务中处理。重复
提交同一份已成功 payload 不会重复创建资产。

## 6. 接入自己的程序

你的程序只需要完成：

1. 自行采集、筛选、识别并整理资产；
2. 按 [Metadata Ingestion Contract](../../docs/metadata-ingestion.md) 生成 JSON；
3. 为 source 和资产使用稳定 identity；
4. 使用现有登录/session 认证；
5. POST 到 `/api/metadata/assets/ingestions`；
6. 根据 `summary`、`items` 和 `errors` 记录结果。

DAP 不要求你的程序使用 Python，也不要求它依赖本仓库。lakehouse-toolkit、内部治理
平台、ETL/调度平台或人工整理脚本都可以成为外部生产者；DAP API 保持通用，不与其中
任何一个系统绑定。

## 7. 明确不做

本 Demo 和 DAP Metadata API 不提供：

- PostgreSQL / MySQL / Hive / Doris / Oracle / DWS 数据库连接或扫描；
- 自动发现 schema、table、column；
- `pg_catalog`、`information_schema`、JDBC、`psycopg` 或 `pymysql` 采集；
- SQL parser、DAG parser、lineage parser 或血缘计算；
- scheduler、Airflow、Celery、Kafka；
- profiling、数据质量扫描、数据生产或离线计算；
- Collector / Connector Plugin Framework；
- 对 lakehouse-toolkit 的 import、submodule 或跨仓库运行依赖。

仓库中早期的 PostgreSQL reference script 仍是历史兼容参考，不是 DAP Core 的自动扫描
能力；本 Demo 不调用它，后续集成应直接提交已经整理好的通用 Contract payload。
