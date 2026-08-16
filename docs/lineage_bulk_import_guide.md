# 血缘快照采集与发布指南

## 数据模型

血缘模块读取以下三张受控快照表：

| 表 | 用途 |
| --- | --- |
| `dwp.p_lineage_snapshot` | 快照元数据、发布批次与 ACTIVE 状态 |
| `dwp.p_lineage_node` | 表、作业等节点 |
| `dwp.p_lineage_edge` | 数据流关系、证据与诊断 |

表级简图和表—作业详图使用同一份快照，不新增表级物化表。表级关系由后端根据
`表 → 作业 → 表` 路径投影，确保每条表级边都能回到实际作业证据。

> 调度元数据表（下方泛化为 `p_job` / `p_program`）是部署环境的数据库契约：
> 表名与列名由各环境的数据仓库调度平台决定，本仓库不维护其 DDL，
> 采集器按部署环境的实际表结构读取。

## 采集来源与规则

`backend/scripts/collect_lineage_snapshot.py` 是正式采集入口：

- 从 `dwp.p_job.c` 读取当前作业，从 `ab` 解析 `<类型>:<前置作业>` 依赖。
- 通过 `p_job.e = p_program.b` 关联程序，并移除 `p_program.k` 的前四个字符得到结果表。
- 名称统一去除首尾空白、反引号和双引号，并转为大写。
- 生成 `作业 → 结果表` 与 `上游结果表 → 下游作业`；无结果表映射时保留作业依赖和诊断。
- 节点 ID 和边 ID 由规范化业务键确定，不使用随机 UUID。
- 无效依赖片段、缺失作业、无表映射和作业依赖环写入快照诊断。

旧的作业—作业 SQL 导入方式已删除，由采集 CLI 完整取代；新的正式快照只能通过采集入口生成。

## 首次运行

先根据数据库类型执行血缘 DDL，并确保数据库配置中存在目标 profile。采集源表和血缘三表
当前要求位于同一个 profile：

```bash
python backend/scripts/collect_lineage_snapshot.py --profile <profile> --dry-run
python backend/scripts/collect_lineage_snapshot.py --profile <profile>
```

`--dry-run` 只读取、解析和校验，不写数据库。成功发布会输出快照 ID、节点数、边数和诊断数。
后端需设置：

```bash
LINEAGE_DB_PROFILE=<profile>
```

## 原子发布与失败回退

采集器先写入 INACTIVE 快照，再写节点和边，最后在同一事务内切换 ACTIVE。任意校验或写入失败
都会回滚，新快照不可见，页面继续读取原 ACTIVE 快照。

发布后至少检查：

```sql
SELECT snapshot_id, generated_at, generator_name, status_code
FROM dwp.p_lineage_snapshot
ORDER BY generated_at DESC;

SELECT kind_code, count(*)
FROM dwp.p_lineage_node
WHERE snapshot_id = '<new_snapshot_id>'
GROUP BY kind_code;

SELECT kind_code, count(*)
FROM dwp.p_lineage_edge
WHERE snapshot_id = '<new_snapshot_id>'
GROUP BY kind_code;
```

需要回退时使用 `docs/dws/lineage-snapshot-rollback.sql`，将其中
`__SNAPSHOT_ID__` 替换为目标历史快照。历史 INACTIVE 快照应按本地保留策略清理，
不要在采集事务中删除当前 ACTIVE 快照。

## 定时执行

门户不承担调度编排。建议在调度元数据表更新完成后，由现有调度平台、
cron 或 Windows Task Scheduler 每日调用一次采集 CLI，并监控非零退出码。

Linux cron 示例：

```cron
30 2 * * * cd /opt/data-asset-portal && /opt/data-asset-portal/.venv/bin/python backend/scripts/collect_lineage_snapshot.py --profile prod >> /var/log/data-asset-portal/lineage-collector.log 2>&1
```

Windows 任务计划程序可将程序设置为 Python 解释器，参数设置为：

```text
/opt/data-asset-portal/backend/scripts/collect_lineage_snapshot.py --profile prod
```

## 查询语义

- `view=table`：默认表级简图。
- `view=detail`：表—作业详图。
- `depth` 在两种视图中均按表跳数计算，作业节点不额外消耗层级。
- 上游追溯遇到 `DWF.*` 或 `DWS_DWF.*` 后停止；下游不应用该截止规则。
- 作业名称搜索会进入详图；表名称搜索沿用当前视图。
