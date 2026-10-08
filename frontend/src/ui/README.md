# DAP UI adapter contract (Phase 2 / PR #3)

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

`Field`, `Select`, and `Combobox` deliberately do not expose `labelTooltip`. The first UI adapter consumer must still validate its workflow-specific accessibility and responsive behavior; this contract does not imply a page migration or overlay approval.
