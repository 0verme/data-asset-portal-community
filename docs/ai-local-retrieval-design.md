# Built-in AI retrieval design (Issue #568)

## Scope and current-main audit

This document records the Phase 0 audit on `origin/main` `62639cf96749eca922a717decf24b5582635efb6` (2026-11-14). It describes only the Community retrieval boundary and its compatibility behavior.

The existing semantic-answer path is already split into four responsibilities:

1. `AIAskExecutionService` performs bounded query planning, multi-query execution, reciprocal-rank fusion, candidate authority checks, progress reporting, cancellation, and overall deadlines.
2. `RagSearchService` calls the configured External Search Service through `RagSearchHttpClient`, then rebuilds table/field recommendations from current DAP metadata. The HTTP v1 request/response contract remains table/field-only.
3. `AssetsService.get_rag_candidate_catalog()` provides bounded authoritative table/field reads; `ReportService`, `IndicatorService`, and `ApiAssetService` expose existing authoritative detail reads for the other supported catalog types.
4. `AIAskService` sends only verified candidate identities to the configured OpenAI-compatible LLM, validates the returned claims against those identities, and creates the response/citations. The same executor and API/SSE routes own admission, quota, cancellation, and timeout behavior.

Deterministic count questions are classified before semantic retrieval and use the existing authoritative COUNT services; retrieval Top-K is not a count. That ordering and its no-answer-generation behavior are preserved.

The existing `SearchProvider.search()` is the single Community keyword-search implementation. It applies the configured database profile, registered entity queries, menu visibility, public-field visibility, bounded per-group limits, and partial-group errors. Its table group already returns stable `assetId`; matched field display values do not currently include the stable `fieldId`. Report, indicator, and API groups expose their existing canonical codes in `ref`, but the current AI response contract accepts only table/field candidates. These are the two smallest compatibility gaps to address. No second search SQL or catalog scan is needed.

The relevant RAG configuration is stored in the existing `RAG_SEARCH_CONFIG/DEFAULT` parameter-dictionary row (`ext_json`); AI/LLM enablement and provider credentials are deployment configuration. There is no need for a new table, migration, or independent service. Existing public catalog profiles and per-request profile calculation remain authoritative; Local search must receive the same profile and use the current detail services before any metadata enters an LLM prompt.

## Retrieval boundary

Use one small mode-aware provider boundary in front of the existing executor:

- `local`: call `SearchProvider.search()` in-process (never loop back through `/api/search`), normalize only supported catalog hits, and resolve all IDs through current DAP detail services.
- `external`: retain `RagSearchService` and its HTTP client, token, timeouts, response parsing, table/field authorization, and failure behavior.

The internal candidate identity is typed: a table is `(table, assetId)`, a field is `(field, assetId, fieldId)`, and reports/indicators/API assets use `(type, canonical code)`. Asset type is part of identity so equal raw IDs across tables cannot collide. Search match text/source/truncation/failure metadata is diagnostic evidence only; names and descriptions included in a prompt must come from authoritative detail reads. An invalid, deleted, inaccessible, or mismatched detail is discarded. A partial search or a result cap is surfaced as degraded/truncated, not as a complete catalog listing.

For Local field recall, add an opt-in internal field-ID projection to the existing SearchProvider call and its current `p_asset_field` query. Ordinary `GET /api/search` keeps its existing output shape. The service still owns SQL construction, profile/scope, and the keyword matching algorithm.

## Mode and upgrade decision table

`retrievalMode` is an optional field in the existing `RAG_SEARCH_CONFIG/DEFAULT` JSON parameter. No startup migration writes or overwrites it.

| Stored state | Effective mode | Behavior |
|---|---|---|
| New install/default config; no mode and RAG disabled | `local` | Local keyword search; no RAG URL/token or HTTP health is required. |
| Existing deployment; no mode and its RAG config is enabled | `external` | Preserve the old retrieval path, even if its token/service is currently unavailable; do not silently switch to Local. |
| Existing deployment; no mode and RAG is disabled | `local` | Deterministic default, matching the new-install default. |
| Explicit `retrievalMode=local` | `local` | Takes precedence over legacy RAG enabled/configuration; no External request. |
| Explicit `retrievalMode=external` | `external` | External only; a disabled/missing/unhealthy External setup fails closed and never falls back to Local. |
| Missing or legacy JSON `null` mode | Apply legacy inference above | No stored value is rewritten just to select a default. |
| Empty, wrong-type, or unknown mode | Invalid configuration; fail closed | Do not infer another mode or start an LLM request. |
| AI explicitly disabled or LLM configuration incomplete | AI unavailable | Do not start a semantic LLM request, regardless of retrieval mode. |

The system parameter is the only mode source; no competing mode environment variable is added. `AI_ASK_ENABLED` and the existing LLM configuration remain the generation gate. The deterministic COUNT branch remains before semantic generation and is not changed into an LLM request.

Rollback requires no schema downgrade. Older code ignores the optional JSON key and retains its former RAG configuration. If an older version is restored while RAG was previously enabled, that version will continue its former External behavior; operators who do not want that behavior must disable the existing RAG configuration before rollback.

## Compatibility and regression baseline

The implementation must leave unchanged:

- External Search Service v1 HTTP payload, authentication, timeout/error handling, and no-fallback semantics.
- Existing JSON/progress/SSE response contracts except strictly additive typed candidate metadata; same routes, LLM provider, quota, admission, cancellation, and worker lifecycle.
- `GET /api/search` default projection, ordinary search visibility and per-group failure behavior.
- Current public catalog profile and menu visibility behavior.
- Existing table/report COUNT services; candidate counts are never presented as full totals.
- Remote/Mock isolation and the existing AI Tab/source-card entry point.

Phase 0 baseline on the exact synchronized main, using the isolated Python dependency path, passed **157 tests** (`Ran 157 tests in 23.833s`, exit 0). Command:

```bash
PYTHONPATH="<isolated-python-site-packages>:$PWD" python3 -m unittest \
  backend.tests.test_ai_ask_service \
  backend.tests.test_ai_ask_execution_service \
  backend.tests.test_ai_ask_api \
  backend.tests.test_ai_ask_contract \
  backend.tests.test_ai_ask_sse_contract \
  backend.tests.test_ai_ask_resource_lifecycle \
  backend.tests.test_rag_search_service \
  backend.tests.test_rag_search_contract \
  backend.tests.test_rag_search_config_storage \
  backend.tests.test_rag_search_config_seed \
  backend.tests.test_search_provider_registry \
  backend.tests.test_search_partial_failure \
  backend.tests.test_search_visibility \
  backend.tests.test_public_catalog_search_policy
```

The raw command output is retained as local task evidence outside the repository. The tests intentionally log mocked timeouts, search failures, and visibility errors; the final suite summary was `OK`.

## Phase 1 implementation notes

The Local table/field provider now calls the registered `SearchProvider.search()` directly with the per-request public-catalog profile. Stable field IDs are opt-in in the existing asset-field query, leaving ordinary `/api/search` output unchanged. The result is only a recall hint: table names, field names, descriptions, domain/layer, and parent relationships are rebuilt from `AssetsService.get_rag_candidate_catalog()` before AI prompting; malformed, missing, duplicate, or mismatched identities are discarded and reported as degraded. Search match evidence is retained for bounded response diagnostics but omitted from the LLM payload. Search errors fail closed, and caps/partial asset-group failures are surfaced rather than described as complete results.

`retrievalMode` is resolved without writing defaults. Legacy enabled External configuration remains External; disabled/no-mode defaults to Local; explicit mode wins; invalid configuration fails closed. Local mode does not require or use the External URL/token, hides the legacy URL from the browser-safe view, and never calls the External HTTP adapter. External mode still uses the existing adapter and never falls back to Local. Admin config updates preserve omitted legacy mode and other omitted settings; enabling Local requires neither an External URL nor token. No new parameter row/table/migration was added. The existing AI executor and outer SSE event lifecycle remain in place; additive candidate retrieval-source/match-evidence fields are accepted by the browser parser.

Phase 1 regression evidence is in the isolated local log `dap-568-test/logs/phase1-ai-retrieval-regression.log`; it includes the baseline AI/RAG/search/visibility modules and Local mode/identity/config tests. The frontend parser and frozen SSE sample are updated for the additive candidate metadata.

## Risks to verify in Phases 1–3

- A Local result must not turn a display match into a `fieldId`; only a real field ID returned by the existing active-field query and confirmed by the authoritative catalog read is referenceable.
- Search group totals and `hasMore` describe bounded keyword matches, not a complete AI answer. Preserve truncation and partial-failure information.
- Legacy External mode is inferred from the existing enabled flag only when no explicit mode is stored. An explicit invalid mode must fail closed rather than select a different provider.
- Local mode must not touch the External HTTP client or require its token/URL. Explicit External must not call Local as recovery.
- Report/indicator/API links and metadata require current service detail reads plus the same public projection/redaction used by their read routes; no new detail pages or database profile are introduced.
- A live production database or external LLM is not part of local validation. Mocked/SQLite and CI-provider coverage must be reported separately from any integration that was not run.
