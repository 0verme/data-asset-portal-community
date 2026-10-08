# DAP UI adapter contract (Phase 2 / PRs #3–4)

`frontend/src/ui/` is the DAP-owned primitive boundary. Application modules must import these adapters, never `@cloudflare/kumo/components/*` directly. The raw imports in `src/kumo-spike/` are an intentional Phase 1 compatibility probe, not production APIs.

Kumo remains pinned at `@cloudflare/kumo@2.14.0`. Adapters consume the DAP theme/token bridge loaded after Kumo standalone and legacy DAP styles. This PR creates API only: it does not authorize replacing existing business controls or CSS.

## Shared rules

- Native input/change semantics are preserved. `Input` and `Textarea` support controlled `value` + native `onChange`, or uncontrolled `defaultValue`; do not provide both. `readOnly` remains distinct from `disabled`.
- Controlled compound controls use `value` + `onValueChange`; uncontrolled controls use `defaultValue`. Do not provide both modes for one control.
- `className` is appended to the adapter's `dap-ui-*` root class when supported. Native refs are forwarded for Button, IconButton, Input, Textarea, Checkbox, Switch, Surface, Grid, GridItem, and Breadcrumbs. Kumo controls without a root-ref contract (Field, Select, Combobox, Tabs, Badge, Status) do not claim one.
- `Field` wraps one control element; when `error` is present, the adapter marks that control `aria-invalid="true"` and Kumo associates the visible error message as its accessible description.
- Standard ARIA and `data-*` attributes are forwarded where the wrapped Kumo primitive accepts them. IconButton requires an accessible name. Input labels should use `Field`, `aria-label`, or `aria-labelledby`.
- Tooltip hooks are intentionally not exposed (`title` on Kumo Button and `labelTooltip` on form controls): Phase 1 found Kumo 2.14.0 Tooltip lacks `role="tooltip"` and trigger `aria-describedby`.

## API and defaults

| Adapter | DAP contract | Kumo mapping |
|---|---|---|
| `Button` | `primary`, `secondary`, `tertiary`, `danger`, `outline`; sizes `sm` / `md` (default `md`) | `tertiary` → `ghost`, `danger` → `secondary-destructive`; `md` → `base` |
| `IconButton` | Same variants/sizes; `icon` and `aria-label` or `aria-labelledby` required; square by default | Kumo Button icon-only shape |
| `Input`, `Textarea` | `intent="default" | "error"`; size `sm` / `md` (default `md`); native input props/events | `default` → Kumo default, `error` → Kumo error; `md` → `base` |
| `Field` | DAP label/description/required/controlFirst; one control child; `error` marks it invalid and exposes the message as its accessible description | Kumo Field; `labelTooltip` omitted |
| `Select` | Single-value control; `value`/`onValueChange` or `defaultValue`; compound Option/Group/GroupLabel/Separator; size `sm` / `md` | `md` → `base`; no Tooltip labels |
| `Combobox` | Typed items/value callback with Kumo compound Content/TriggerInput/List/Item/Empty parts; supports optional multi-value mode | `md` → `base`; Chinese labels default for clear/show-options actions |
| `Checkbox` | Controlled `checked`; `onCheckedChange` always reports boolean (`indeterminate` normalizes to `false`); `intent` default/error | Kumo Checkbox |
| `Switch` | Controlled `checked` and boolean `onCheckedChange`; native disabled/ARIA props | Kumo Switch |
| `Badge` | Semantic tones `brand`, `neutral`, `success`, `warning`, `danger`, `info`; filled by default | `danger` → Kumo error; `neutral` → Kumo secondary |
| `Status` | Status-only dotted badge (`success`, `warning`, `danger`, `neutral`) | Kumo Badge dot appearance |
| `Tabs` | Controlled `value`/`onValueChange` or `defaultValue`; `appearance="line" | "segmented"` (default `segmented`); size `sm` / `md`; manual activation by default | `line` → underline; `md` → base; scroll labels default to Chinese |
| `Surface` | DAP name for a simple/layered card; div props/className/ref; `Primary` and `Secondary` sections | Kumo `LayerCard` (not deprecated Kumo `Surface`) |
| `Grid` / `GridItem` | Grid columns `2 | 3 | 4 | 6`, density `compact` / `normal` / `spacious` (default `compact`); native div props/className/ref | Kumo `2up`/`3up`/`4up`/`6up`; density maps to `sm`/`base`/`lg` gaps |
| `Breadcrumbs` | Accessible Chinese-labeled nav; callback or href items; last item is current page | DAP-owned markup preserves DAP callback navigation semantics that Kumo Breadcrumbs does not express |

`Field`, `Select`, and `Combobox` deliberately do not expose `labelTooltip`. The first UI adapter consumer must still validate its workflow-specific accessibility and responsive behavior; this contract does not imply a page migration.

## Overlay and feedback adapters (PR #4)

The adapters below are the only approved DAP entry points for shared overlay/feedback behavior. They wrap Kumo 2.14.0 primitives inside DAP-owned contracts; application code must not import Kumo overlay deep paths directly.

| Adapter | DAP contract | Compatibility behavior |
|---|---|---|
| `Dialog` | Controlled `open` / `onOpenChange`, required title, optional description, `dialog` / `alertdialog`, size `sm` / `md` / `lg` / `xl`; outside click enabled by default | Uses the shared `#dap-ui-overlay-root`, provides its popup ref to nested overlays, explicitly exposes modal ARIA semantics, traps focus and restores trigger focus; busy dialogs cannot dismiss; the popup stays outside `#root` and does not apply Kumo's incompatible `aria-hidden` behavior |
| `ConfirmDialog`, `ConfirmDialogHost` | Promise-based `confirmAction`, `confirmDelete`, and `confirmDeleteAction`; optional exact keyword, details, danger, async busy state | Keyword is trimmed before exact comparison; rejected async action keeps the confirmation open; no-host `confirmAction` resolves `false` |
| `FormModal` | Controlled open state, title/subtitle, optional icon, content, cancel/submit callbacks, busy and outside-click controls | Reuses `Dialog`; asynchronous submit disables dismissal until settled; visible error reporting remains the caller's responsibility |
| `Tooltip` | React-element trigger, content, side/alignment/delay and optional container | Adds `role="tooltip"` and a live trigger `aria-describedby` relationship absent in Kumo 2.14.0; nested tooltips portal into the active dialog |
| `Popover`, `DropdownMenu` | Kumo compound API with DAP portal/container and layering | Container is inherited from the surrounding DAP Dialog; DAP imports stay encapsulated in `src/ui/` |
| `ToastHost`, `toast` | `success`, `error`, `warning`, `info`; default timeout 3200ms with explicit override | Toast manager is mounted through one host; without a host, existing `window.alert` fallback is retained; notifications render under the shared body-level overlay root, outside the application `#root` |
| `Banner`, `LoadingState`, `EmptyState`, `ErrorState` | Semantic tone, loading, empty and retryable error states | Error banner uses `role="alert"`; other status feedback uses a polite status role |

The `Dialog` adapter intentionally avoids Kumo's high-level `components/dialog` wrapper and composes the raw Dialog primitive because the wrapper's `#root aria-hidden` behavior conflicts with the existing DAP modal host. `Tooltip` likewise avoids the high-level `components/tooltip` behavior and composes raw primitives to supply the missing role/description relationship. These workarounds are limited to DAP adapters and covered by the Chromium/WebKit evidence below.

`Dialog` focus handling, portal placement, Tooltip ARIA, Escape/outside dismissal, async/busy confirmation and toast timeout/fallback are covered by the Issue #355 Chromium/WebKit fixture and contract tests. These adapters do not authorize business-page/AppShell migration, legacy CSS cleanup, or a change to route/history, RBAC, API or database behavior.
