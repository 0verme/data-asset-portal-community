# #403 非生产测量恢复点

状态：WAITING_ENV。Phase 1 的 #418/#423 已在 main；没有授权的代表性数据快照，未执行真实性能测量，不引入索引或新缓存。

## 准备与执行

1. 维护者提供可恢复、脱敏的非生产快照及其规模：表数、字段数、来源系统数、每表字段分布、数据库版本、已有索引、CPU/内存。禁止以 Demo/fixture 声称百万级实测。
2. 在同一 HEAD 启动只连接该快照的后端，绑定 loopback；停止其他数据写入。记录数据库统计信息和现有缓存 TTL。不得清生产缓存或修改业务数据。
3. 从仓库根执行（Windows 使用 `.\backend\.venv\Scripts\python.exe`，Linux 使用 `backend/.venv/bin/python`）：

   ```text
   backend/scripts/measure_field_mapping_http.py --base-url http://127.0.0.1:15099 --samples 10
   backend/scripts/measure_field_mapping_http.py --base-url http://127.0.0.1:15099 --samples 10 --source-system-id <approved-id>
   ```

   认证使用当前非生产账号；如部署支持 Bearer token，可通过进程环境 `DAP_MEASURE_TOKEN` 提供，禁止写入报告。工具只 GET、禁止重定向，只输出聚合计数与耗时；loopback 不能自动证明数据库非生产，运行前必须核实 profile。
4. 分别测全量、常见/稀疏来源、无命中条件和后续页，记录首个请求与重复请求；工具默认只测第一页和来源过滤，其他筛选与分页通过既有浏览器流程补齐。HTTP 耗时包含 COUNT、查询、传输与序列化，不是 COUNT 独立耗时。配合数据库只读执行计划/已有查询日志分离 COUNT、列表和 stats 成本，不开启生产日志或执行未知 EXPLAIN ANALYZE。
5. 用 Remote 生产包在 Chromium 记录导航→表列表可操作、stats 完成、首次切字段的时间；保留网络瀑布。工具不是首屏或真实数据库浏览器验收。
6. 同一静止快照中，fields.total 必须等于 stats.fieldCount；table.total 与 stats.sourceTableCount 按相同过滤范围比较。翻页并核对稳定身份与排序，无漏项/重项。快照变化或缓存混合时先定位，不能忽略差异。

## 决策门禁

- Phase 2：只有列表/COUNT/筛选/首屏瓶颈有独立证据，才选择最小查询优化；记录前后计划、p50/p95、数据一致性、数据库方言与回滚。
- Phase 3：先确认已有 stats cache 的键、TTL、失效和写入路径，再判断是否需要额外缓存；没有证据不扩缓存。
- 当前真实数据、独立 COUNT 耗时、首屏、百万级性能全部 NOT RUN。工具的隔离测试只能证明测量行为，不替代上述验收。
