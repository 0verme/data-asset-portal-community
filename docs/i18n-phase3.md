# Frontend i18n: Phase 3 conventions

Phase 3 localizes the dictionary, integration, and administration UI. Translation is presentation-only: changing the language must not change a record, permission, request, route, or persisted value. Chinese remains the source-key fallback when a translation is missing.

## Namespaces and glossary

| Source term | English UI term | Scope |
| --- | --- | --- |
| 词根 / 词根库 | Root / Root Library | Naming roots used to compose warehouse table and field names |
| 码值表 / 手工码值表 | Code table / Manual code table | Table-level metadata; code entries are not maintained here |
| 上游卸数 | Upstream extraction | Upstream system and extraction configuration |
| 下游推送 | Downstream push | Downstream system and push jobs |
| 字段清单 | Field list | Interface field metadata |
| 业务部门 | Business department | Built-in UI label; the selected/custom value is data |
| 操作日志 | Operation Logs | Administration audit display |
| 系统管理 | System Management | Administration navigation and access-gate copy |

Use the existing `dictionary`, `integration`, `admin`, and `common` namespaces for these areas. Source-keyed Phase 3 copy uses `keySeparator: false`; keep the exact Chinese source string as the lookup key and preserve Chinese fallback behavior. Dynamic values must use interpolation (for example, `{{count}}`, `{{name}}`, and `{{param}}`) rather than concatenated translated fragments.

## Hard-coded-copy exception list

The following values intentionally remain untranslated, even when they contain Chinese or English text:

- **Business/user metadata:** root abbreviations and names, descriptions, categories, table and field names, owner/contact names, departments, system names/abbreviations, job names, remarks, and operation-log payloads. These are records, not UI copy.
- **Custom and unknown dictionary values:** custom menu labels, categories, department/frequency/status options unknown to the built-in catalog, unknown permission codes, and unknown enum values. Translate only recognized built-in display labels; never translate the submitted or persisted value.
- **Machine/API contracts:** routes and query keys, menu identifiers, role/permission codes, API fields and payloads, status/frequency codes, delimiters, file formats, validation constraints, and formulas. A localized label may describe a value, but must not replace it in requests or storage.
- **External content:** backend/provider error text, imported file contents, server-provided labels, CSV cell data, and user-generated text. Only known local UI feedback is translated. The CSV download filename and local mock column headers may follow the UI locale; exported record values and remote CSV responses are not rewritten.
- **Technical tokens and package boundaries:** identifiers such as `JDBC`, `HTTP`, `RAG`, `CSV`, and `TSV` remain as written where they are technical content. DAP locale resources and language state stay outside lineage-viewer packages.

When adding UI copy, add both locale entries, include interpolation in both values, and extend locale parity tests. When deciding whether a string is copy or data, preserve the value unless it is a known built-in UI label.
