# 资产风险与审计平台联动设计

> 状态：**部分实现 / 外部接入待实现**。资产详情页已经支持统一的 `assetRisks` 展示模型；外部审计平台适配、风险查询接口、实时校验和问题闭环尚未实现。

## 1. 目标与边界

资产门户负责资产盘点、画像、治理提示和修复入口；审计平台负责规则扫描、问题识别和证据输出。两者通过稳定风险对象协作，但保持独立部署：外部来源不可成为门户启动、资产查询或编辑功能的前置依赖。

当前不实现规则配置中心、强阻断保存、派单认领、状态流转或完整问题闭环。审计规则不复制到门户，避免规则分裂。

## 2. 当前实现

- 后端资产详情返回 `assetRisks`，没有风险时为 `[]`。
- 前端 `AssetRisksPanel` 消费统一模型，支持风险级别、来源、说明、建议和可选处理入口。
- 当前后端尚未接入外部风险来源，默认返回空数组。
- 风险展示失败不得影响资产字段、DDL 和其他详情内容。

门户内部统一模型如下：

```json
{
  "risk_id": "RISK-001",
  "risk_source": "external",
  "source_system": "audit-platform",
  "rule_code": "FIELD_ROOT_MISSING",
  "rule_name": "字段命名词根缺失",
  "severity": "warning",
  "asset_type": "field",
  "asset_key": "dwd.customer_order.order_amt",
  "asset_name": "订单金额",
  "message": "字段未匹配到标准词根。",
  "suggestion": "补充词根或调整字段命名。",
  "action_type": "open_root_mapping",
  "action_url": "/field-mapping?asset_key=dwd.customer_order.order_amt",
  "evidence": {},
  "created_at": "2026-07-05T00:00:00+08:00"
}
```

## 3. 外部风险适配契约

外部审计问题只有在能稳定定位到表、字段、指标、词根、系统、任务或链路等资产对象，且对长期资产画像有意义时，才转换为 `assetRisks`。仅与一次提交、分支、diff 或审计任务相关的问题留在审计平台。

建议映射：

| 外部字段 | 门户字段 |
| --- | --- |
| `issue_id` | `risk_id` |
| `source_system` | `source_system`，同时将 `risk_source` 归一为 `external` |
| `rule_code` / `rule_name` | 同名字段 |
| `severity` | `error` / `warning` / `info` |
| `asset_type` / `asset_key` / `asset_name` | 同名字段 |
| `message` / `suggestion` / `evidence` | 同名字段 |
| `portal_action` / `fix_url` | `action_type` / `action_url` |
| `created_at` | `created_at` |

`asset_key` 必须使用稳定技术标识，例如 `schema.table`、`schema.table.column` 或 `metric_code`。`action_url` 只允许站内路径或 `http(s)`，拒绝 `javascript:`、`data:` 等协议。未知风险级别降级为 `warning` 或 `info`，未知来源按外部来源安全展示。

## 4. 分阶段接入

第一阶段采用离线导入或按资产查询，优先覆盖表命名/分层、字段词根、字段注释、字段类型和资产待核对风险。门户只展示、定位并跳转到已有维护页面，不阻断保存。

第二阶段再评估保存前轻量校验、SQL/指标风险、调度依赖、上下游推送完整性和血缘影响摘要。所有阶段都必须允许审计平台离线或未配置。

## 5. 安全约束

- 风险对象、证据、日志和链接不得包含密码、Token、Cookie、完整连接串或生产凭据。
- 外部输入必须校验类型、长度、枚举和 URL 协议；展示文本按普通不可信内容处理。
- 批次、任务和外部接口地址不是资产详情的必填字段。
- 外部适配失败应记录可诊断日志，并返回空风险列表或最近一次有效快照。

## 6. 未实现事项

- 外部风险导入/查询接口及持久化模型。
- `unifiedAssetIssues` 到 `assetRisks` 的服务端适配器。
- 风险筛选、统计、独立列表和处理状态。
- 实时校验、问题闭环与跨系统身份权限设计。
