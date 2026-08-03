# Prototype Binding - Story Section Template

Add this section to every UI-bearing story. Fill it from the design-source
artifacts; keep it under ~30 lines. It replaces prose screen descriptions.
Write it in the project's documentation language.

```markdown
## Prototype Binding

Prototype hash: {MANIFEST hash at story creation}

| Route | Baselines | Rendered HTML | Source slice |
|---|---|---|---|
| {ROUTE_ID} | design-source/baselines/{ROUTE_ID}.desktop.png, .mobile.png | design-source/rendered/{ROUTE_ID}.desktop.html | design-source/screens/{ROUTE_ID}.source.txt |

Click path: {menu/label sequence a user follows to reach this screen in the prototype}
Screen modes in scope: {list, create, edit, modal, drawer, empty, error...}

Overlays in scope - ENUMERATE by scanning the screen's source slice and
rendered fragment for every overlay trigger: add/edit/delete/configure
buttons, drawer/modal open calls, confirmation prompts. An empty table is
only valid with the explicit statement "no overlay trigger found in the
fragment". Each overlay gets its own baseline pseudo-route AND its own parity
pair - desktop and mobile primitives may differ:
| Overlay | Pseudo-route id | Desktop primitive | Mobile primitive | Opened by |
|---|---|---|---|---|
| {e.g. cancel confirmation} | {ROUTE__CANCEL_CONFIRM} | {modal} | {bottom sheet} | {click "Cancel order"} |

Dev directive: port the rendered HTML / source slice into the project template
system, preserving structure, spacing, colors and component primitives via the
shared theme tokens. Replace example data with real bindings. No structural
deviation without a product decision recorded below.

Data classification (visible prototype values):
- static_copy: {labels, headings, empty-state copy that ship as-is}
- example_data: {sample records demonstrating layout - never hardcode}
- production_data: {values that must come from backend/read models}
- derived: {values computed from other fields by a stated rule, e.g.
  "computed total = quantity x unit price" - implement the RULE, never
  freeze the prototype's example result}

Interactions (behavior a screenshot cannot prove - verified by hand at gate time):
- dependent controls: {parent -> child scoping, e.g. "city options limited
  to the selected country, stale selection cleared on country change",
  or "none"}
- derived fields: {field -> inputs + rule, must recompute when inputs change,
  or "none"}
- anchors: {nav link -> target section, landing offset behavior, or "none";
  add a fullPage:false pair with a click/scrollTo step when the landed view
  matters}
- reveals/animations: {trigger -> revealed element (accordion, tooltip, hover,
  appear-on-scroll), or "none"; capture end states via steps - the motion
  itself (duration, easing) is judged by hand}

States without prototype source: {state -> decision, or "none"}

Product decisions / approved deviations:
- {decision or "none"} - also add durable ones to design-source/deviations.md
  (see proto-parity-check/references/deviations-registry.md) so future gates
  and audits respect them beyond this story
```

## Definition of done hook

The story is not `done` until `proto-parity-check` passed for every route and
viewport listed here. Only `pass` and `pass-with-approved-deviation` close a
route; the latter requires an approved registry row. `fail`, `blocked`, and
`blocked-pending-decision` keep the story open, so a recorded but pending
product decision is never sufficient for completion.
