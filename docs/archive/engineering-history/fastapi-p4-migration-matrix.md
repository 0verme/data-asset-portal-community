# FastAPI P4 Migration Matrix（#16 / #53）

> **Historical migration record**：本矩阵保留 P4 阶段的 Flask/FastAPI parity、DB_READY 与迁移状态证据。当前 API/runtime truth 以 [架构说明](../../architecture.md)、[模块清单](../../modules.md) 和 [API 契约](../../api-contract.md) 为准；表中的 Flask 列不表示当前存在 Flask runtime。

本矩阵基于 `origin/main` `76a766cbebfc9dca37a88e00137d1ebe6980297f` 审计。DB_READY 同时要求对应 Database Lane PR 已合并、当前没有 active DB PR 修改 Service、Service 接口稳定，并且 adapter 不需要修改 database infrastructure。

| Module | Flask | FastAPI | Contract | Parity | DB_READY | Action / Status |
| --- | --- | --- | --- | --- | --- | --- |
| Indicator | `/api/indicators` | P3 adapter | P2 | PASS | PR #44 | DONE（P3 / PR #62） |
| Indicator Path | `/api/indicator-path/tree` | — | — | — | NO（无对应 DB Core PR） | WAIT_DB |
| Assets | `/api/assets` | P4 adapter | P2 | PASS | PR #43 | DONE（PR #64） |
| Field Mapping | `/api/field-mappings` | P4 adapter | P2 | PASS | PR #47 | DONE（PR #69） |
| Root | `/api/roots` | P4 adapter | P2 | PASS | PR #54 | DONE（PR #71） |
| Manual Code Table | `/api/manual-code-tables` | P4 adapter | P2 | PASS | PR #46 | DONE（PR #72） |
| Report | `/api/reports` | P4 adapter | P2 | PASS | PR #45 | DONE（PR #74；private capability） |
| API Asset | `/api/api-assets` | P4 adapter | P2 | PASS | PR #57 | DONE（PR #75） |
| Lineage | `/api/lineage` | P4 adapter | LineageResponse | PASS | PR #61 | DONE（PR #77） |
| System User | `/api/system/users` | P4 adapter | SystemResponse | PASS | PR #63 | DONE（PR #79） |
| System Menu | `/api/system/menus` | P4 adapter | SystemResponse | PASS | PR #68 | DONE（PR #79） |
| System Dictionary | `/api/system/param-dicts*` | P4 adapter | SystemResponse | PASS | PR #65 | DONE（PR #79） |
| Operation Log | `/api/operation-logs` | P4 adapter | SystemResponse | PASS | PR #59 | DONE（PR #79） |
| Upstream | `/api/upstreams` | P4 adapter | UpstreamResponse | PASS | PR #76 + #78 | DONE（PR #80） |
| Push | `/api/push` | — | — | — | NO（无对应 DB Core PR） | WAIT_DB |
| Common Code | `/api/common-codes` | — | — | — | NO（legacy `fetch_all` Service，暂无 DB Lane Core PR） | WAIT_DB |
| Portal Stats | `/api/portal/stats` | Native infrastructure adapter | Portal stats contract | PASS | N/A（跨模块聚合 / fallback） | DONE（F3 / #104；legacy adapter retired） |
| Unified Search | `/api/search` | Native infrastructure adapter | Search API Contract | PASS | N/A（跨模块聚合 Provider） | DONE（F3 / #104；legacy adapter retired） |
| Auth (`login/me/logout`) | `/api/auth` | Native signed-session adapter | API Contract | PASS | N/A（session/runtime boundary） | DONE（F2 / #102；legacy adapter retired） |
| Capabilities | `/api/capabilities` | Native infrastructure adapter | Capability payload | PASS | N/A（capability infrastructure） | DONE（F3 / #104；legacy adapter retired） |

## P4 Close Result

所有当前 DB_READY 的 business API 均已具备 FastAPI adapter、shared Service reuse、contract/native regression coverage 与 green PR CI。Auth 已在 F2/#102 增加 native signed-session adapter；Capabilities、Portal Stats、Unified Search 已在 F3/#104 增加 native infrastructure adapters；Common Code、WAIT_DB 模块没有被强行迁移，legacy Flask routes 已退出 production 并按 F7 清理。P4 的剩余项属于 Database Lane 前置工作或 P5 runtime/infrastructure，不阻塞本轮 DB_READY 迁移收口。
