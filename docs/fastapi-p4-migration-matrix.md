# FastAPI P4 Migration Matrix（#16 / #53）

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
| Portal Stats | `/api/portal/stats` | — | — | — | N/A（跨模块聚合 / fallback） | INFRASTRUCTURE / P5 |
| Unified Search | `/api/search` | — | — | — | N/A（跨模块聚合 Provider） | INFRASTRUCTURE / P5 |
| Auth (`login/me/logout`) | `/api/auth` | — | — | — | N/A（session/runtime boundary） | P5 cutover |
| Capabilities | `/api/capabilities` | — | — | — | N/A（capability infrastructure） | INFRASTRUCTURE / P5 |

## P4 Close Result

所有当前 DB_READY 的 business API 均已具备 FastAPI adapter、shared Service reuse、contract/parity coverage、Flask rollback 与 green PR CI。WAIT_DB 模块没有被强行迁移，Flask routes 全部保留。P4 的剩余项属于 Database Lane 前置工作或 P5 runtime/infrastructure，不阻塞本轮 DB_READY 迁移收口。
