# Pydantic API Contract（#16 P2）

本文记录 #16 P2 建立的框架中立 API Contract 边界。`backend/app/contracts/` 描述 JSON wire format，由 FastAPI Native adapter 复用；P2 不重新设计 API。

## 当前覆盖

- `ReportItem` / `ReportRequest` / `ReportListResponse`；
- `IndicatorItem` / `IndicatorRequest` / `IndicatorListResponse`；
- `AssetItem` / `AssetField` / `AssetTableRequest` / `AssetPageResponse`；
- 通用 `ErrorEnvelope`、`DataEnvelope`、`ItemsResponse`、`MessageDataResponse`。

Report、Indicator、Assets route 的成功和业务错误响应在 HTTP adapters 中通过 `validate_contract` 校验；校验函数返回原始 payload，不重新 dump，避免改变已有字段缺失、`null`、legacy alias 或额外字段的语义。

## 兼容性规则

- 现有 camelCase 字段保持不变；
- legacy/additive 字段保留，contract model 使用 `extra="allow"`；
- 可选输入字段默认为 `None`，不会把缺失字段变成新的业务默认值；
- `relatedTables`、`relatedIndicators` 等公开数组的 envelope 不变；
- Assets summary 的 `items`、`page`、`pageSize`、`total` 分页形状保持不变；
- 认证失败、not found、validation failure 继续使用现有 status code 与 `{error:{code,message,details}}` 结构。

## FastAPI 复用现状

FastAPI Native adapter 已使用这些模型作为 request/response model，并通过 native contract/regression tests 固化现有行为；P2 不改变 Database Lane 的 service 或 CoreAccess。

## 验证

```text
D:/miniconda3/python.exe -m pytest backend/tests/test_api_contracts.py -q
D:/miniconda3/python.exe -m ruff check backend/app/contracts backend/app/routes/report.py backend/app/routes/indicator.py backend/app/routes/assets.py backend/tests/test_api_contracts.py
```
