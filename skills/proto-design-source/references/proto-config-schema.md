# proto.config.json Schema

Shared by `capture_baselines.mjs` (this skill) and reused as the base for
`parity.config.json` (proto-parity-check skill).

```json
{
  "prototype": "file:///abs/path/prototype.html",
  "navigation": { "mode": "hash" },
  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900 },
    { "name": "mobile", "width": 390, "height": 844 }
  ],
  "routes": ["ADMIN_DASHBOARD", "ADMIN_ORDERS"],
  "outDir": "_bmad-output/design-source",
  "waitMs": 1200,
  "readySelector": "#root *",
  "fullPage": true
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `prototype` | yes | `file://` URL or `http(s)://` URL. Relative paths are resolved from the config file location. |
| `navigation.mode` | yes | `hash` -> loads `{prototype}#{route}`. `query` -> `{prototype}?{navigation.param}={route}` (`param` default `route`). `path` -> `{prototype}/{route}`. `click` -> per-route `steps`. |
| `viewports` | yes | Named viewports. Names are reused in output filenames. |
| `routes` | yes | Array of route ids, or array of objects `{ "id": "X", "steps": [...] }` when `mode` is `click`. |
| `outDir` | yes | Output root. Relative to the config file location. |
| `waitMs` | no | Extra settle time after load + ready selector. Default `1000`. |
| `readySelector` | no | Capture waits until this selector exists. Use the prototype's root content selector. |
| `fullPage` | no | Default `true`. Set `false` for viewport-only capture. |
| `renderedRootSelector` | no | Element whose rendered DOM is exported to `rendered/`. Default `body`. For SPA prototypes use the app mount point (e.g. `#root`) so exported fragments contain only rendered markup, not embedded sources. `<script>` tags are always stripped. |

## `click` navigation steps

For prototypes without addressable routes:

```json
{
  "id": "ADMIN_PRODUCT_EDIT",
  "steps": [
    { "click": "text=Products" },
    { "click": ".product-card >> nth=0" },
    { "click": "text=Edit" }
  ]
}
```

Step types, executed in order after load: `{ "click": "sel" }`,
`{ "fill": { "selector": "sel", "value": "v" } }`, `{ "hover": "sel" }`
(tooltips, hover reveals), `{ "scrollTo": "sel" }` (anchor targets,
scroll-triggered reveals), `{ "waitMs": 500 }` (let transitions finish before
the screenshot). Prefer `hash`/`query`/`path` whenever the prototype supports
it: addressable routes make captures reproducible.

## Anchor and reveal states

- **Anchors** (nav links that scroll to a page section): a full-page capture
  contains the whole page, so it cannot tell whether the anchor *lands* at the
  right place. To compare the landed view mechanically, declare a pseudo-route
  (or parity pair) with `"fullPage": false` + a `click`/`scrollTo` step: the
  viewport screenshot then shows exactly what a user sees after the jump,
  header offset included.
- **Reveals** (accordions, tooltips, hover states, appear-on-scroll): capture
  the END STATE via steps (`click`/`hover`/`scrollTo` + `waitMs` long enough
  for the transition to finish). The motion itself - duration, easing,
  direction - is invisible to screenshots and stays a by-hand check.

## Overlay states (modals, drawers, popins, bottom sheets)

Overlays only exist after a click, so a route-level capture never shows them.
Declare each overlay as a pseudo-route: `base` is the real route the capture
navigates to (hash/query/path), `steps` open the overlay, and the `id` names
the state:

```json
{
  "id": "ADMIN_ORDER_DETAIL__CANCEL_CONFIRM",
  "base": "ADMIN_ORDER_DETAIL",
  "steps": [ { "click": "text=Cancel order", "waitMs": 400 } ]
}
```

Capture every overlay at BOTH viewports: prototypes commonly use a different
primitive per breakpoint (modal on desktop, bottom sheet on mobile), and each
variant needs its own baseline. Without an overlay baseline, developers have
no visual reference for the overlay's buttons, colors, and sizes, and the
parity gate never sees it.
