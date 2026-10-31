# #403 字段映射性能与一致性验证

## 范围与安全边界

本次仅使用确定性合成记录和临时 SQLite 数据库；没有连接生产库、真实业务数据或外部数据库。现有渐进加载实现（#418/#423）继续复用，本 PR 不改分页语义，也不涉及 #464。

性能测量在服务层直接调用 `FieldMappingService`，记录一次服务调用的总耗时及服务发出的 SELECT 数量；它不代表 HTTP/浏览器耗时，也不代表 PostgreSQL、MySQL 或 GaussDB/DWS 的真实性能。合成数据固定为每表 10 个字段、10 个上游系统，字段名、映射率和空注释按确定性规则生成。`p95` 使用 nearest-rank 计算，样本量见结果表；本次测量环境为 Linux x86_64、8 个逻辑 CPU、Python 3.11.2、SQLite 3.40.1。SQLite/OS 页缓存未主动清空；NAS 是共享测试环境，未对并发系统活动作排他控制，因此这些是本机服务层观测值，不构成 SLO 或生产性能结论。

## 可复现实验

从仓库根目录运行，`--scratch-dir` 必须指向仓库外、按 Issue 隔离的测试目录。脚本为每个规模创建唯一临时目录，并在退出时删除数据库和本地配置：

```bash
PYTHONPATH=. python backend/scripts/benchmark_field_mapping_synthetic.py \
  --scratch-dir /path/to/data-asset-portal-community_base/dap-403-test/field-mapping-benchmark \
  --scales 100000,500000,1000000 --samples 5
```

报告覆盖：stats 重复读取（统计无进程内应用缓存，每次调用都查询数据库）、字段与表列表第 1 页和第 1000 页、精确 tablePk / sourceSystemId 筛选、并行 stats + 表列表、代表性过滤下字段/表计数一致性，以及 SQLite 查询计划。实验不关闭 SQLite/OS 页缓存。数据库查询计数在服务的 `_fetch_rows` 边界采集。

## 合成数据结果

| 字段数 | 表数 | 数据库大小 | 样本数 | stats 重复读取 p50/p95 | 字段/表第 1000 页 p95 | 备注 |
|---:|---:|---:|---:|---:|---:|---|
| 100,000 | 10,000 | 16,433,152 B（15.67 MiB） | 3 | 88.85 / 91.99 ms | 491.44 / 168.11 ms | PASS：过滤计数一致；stats 每次 1 个 SELECT、分页每次 2 个 SELECT。仅合成 SQLite 服务层测量。 |
| 500,000 | 50,000 | 80,707,584 B（76.96 MiB） | 3 | 520.20 / 541.20 ms | 2,056.61 / 1,208.93 ms | PASS：过滤计数一致；stats 每次 1 个 SELECT、分页每次 2 个 SELECT。仅合成 SQLite 服务层测量。 |
| 1,000,000 | 100,000 | 161,452,032 B（153.97 MiB） | 3 | 866.32 / 919.12 ms | 2,744.76 / 1,727.39 ms | PASS：过滤计数一致；stats 每次 1 个 SELECT、分页每次 2 个 SELECT。仅合成 SQLite 服务层测量。 |

计数一致性逐一比较相同过滤条件下的 `fields.total == stats.fieldCount` 及 `tables.total == stats.sourceTableCount`；任何不一致均使基准失败。未完成或未运行的规模必须明确列为 NOT RUN，不以外推值补齐。过滤一致性是每种规模的一次性校验，不计入表中重复读取 p95；500k/1m 校验期间分别记录到约 3.010s/5.333s 的 stats 慢调用诊断。该诊断不含过滤条件，不能归因到某一种筛选，也不是独立 p95 样本；筛选延迟仍需按目标数据库和生产配置另行评估。

## 查询与一致性决策

字段列表以精确 `tablePk` 或 `sourceSystemId` 筛选时，旧执行计划扫描字段映射表。新复合索引 `idx_p_field_mapping_field_table_deleted(table_pk, is_deleted)` 用于该连接/软删除谓词；只读副本上的 SQLite 计划探测确认精确 tablePk 查找使用 covering index，来源系统过滤先使用既有 `idx_p_field_mapping_table_identity` 再查字段索引。服务查询不再对一对一连接后的字段主键做多余 `COUNT(DISTINCT)`；源系统和源表仍保留 distinct 计数。

统计不再使用进程内 TTL 字典：每次请求读取数据库，因而导入、其他服务实例或外部 SQL 提交后不会返回进程缓存中的旧统计。代价是重复 stats 访问仍会执行数据库查询；报告同时保留其延迟和 SELECT 数量。未对 `%substring%` / 多列 keyword 搜索增加数据库特定的全文索引；这些过滤仍可能扫描数据。

## 数据库与环境验证状态

- SQLite 合成测量与 SQLite 前向迁移：结果见本次验收记录。
- PostgreSQL / MySQL：只运行离线 schema 验证与方言 SQL 编译；真实数据库集成 NOT RUN（本地未配置隔离实例）。
- GaussDB/DWS：运行离线 schema 验证及 DWS adapter 模拟测试；真实 GaussDB/DWS 8.1.3 执行 NOT RUN，仍需维护者按 `backend/alembic/REAL_DWS_VALIDATION.md` 验证。
- 公开数据 guard、前端、后端检查的逐项状态在 PR 描述中记录。
