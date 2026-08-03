# Deviations Registry

The prototype is the *starting* contract, not a cage. Implementations
legitimately evolve past it: manual-testing improvements, backend-imposed
features the prototype never drew, accessibility adjustments. The registry
makes those decisions durable so the parity gate stops re-flagging them on
every future story and never "fixes" an intentional change back to the
prototype.

Location: `{design-source dir}/deviations.md`. One table, append-only rows:

```markdown
# Parity Deviations Registry

| Route | Viewport | Scope | Type | Decision & reason | Date | Status |
|---|---|---|---|---|---|---|
| ADMIN_ORDERS | both | header actions | impl-improvement | "Export" button kept, added after manual testing | 2026-07-09 | approved |
| ADMIN_LOG | both | severity filter | impl-only-feature | Backend requires it; prototype never drew it - user will restyle by hand if needed | 2026-07-09 | approved |
| ALL | both | status text colors | token-adjustment | Darker fg for WCAG contrast, differs from prototype T object | 2026-07-09 | pending |
| ADMIN_SETTINGS | both | whole screen | impl-canonical | Screen redesigned after user testing; prototype outdated | 2026-07-09 | approved |
```

## Fields

- **Route**: prototype route id, or `ALL` for theme/token-level rows.
- **Viewport**: `desktop`, `mobile`, or `both`.
- **Scope**: element or region (`whole screen` allowed).
- **Type**:
  - `impl-improvement` - the user intentionally changed the implementation after dev; the implementation wins for this scope;
  - `impl-only-feature` - the feature exists only in the implementation because the product/backend requires it and the prototype lacks it; the gate must NOT block it - implement it with the shared theme tokens and the closest prototype patterns, and let the user restyle manually later. **Before adding this row, scan the prototype screen - INCLUDING its non-default tabs, sub-panels and overlays - for an existing pattern serving the same need.** A prototype tab nobody captured is not a missing feature: if the prototype already answers the need, the right move is capturing that state and aligning to it (proto-alignment), never inventing a new block on a frozen screen;
  - `token-adjustment` - a theme-level value that intentionally differs (e.g. accessibility contrast);
  - `proto-example-data` - difference is data, not design;
  - `proto-only-deferred` - the prototype draws a control or state whose epic
    has not shipped yet; mask that control in the pair and remove the row
    when its epic delivers it;
  - `impl-canonical` - the whole screen's source of truth flipped to the implementation; the gate skips pixel comparison for this route and only checks navigation/click-path.
- **Status**: `approved` (not a finding; report as "approved deviation") or `pending` (the route's verdict becomes `blocked-pending-decision`: surfaced once per run, never counted as fail, never silently passed - it resolves only when the user settles the row).

## Gate rules

1. Load the registry before judging any composite.
2. A difference covered by an `approved` row is not a finding - record it as `pass-with-approved-deviation`.
3. A `pending` row is surfaced to the user once per run and makes the covered route's verdict `blocked-pending-decision`; it neither fails nor passes silently.
4. An implementation surface with no prototype route at all is out of the gate's scope: no pair, no comparison. Record it once as `impl-only-feature` so future audits don't rediscover it.
5. Never revert an implementation change to match the prototype without checking the registry first; if the change looks intentional but has no row, ask the user instead of "fixing" it.
6. When a screen accumulates so many deviations that the composite is mostly red, propose flipping it to `impl-canonical` or updating the prototype (then recapture - the new hash refreshes the baselines and the rows for that route can be pruned).

## Freeze hygiene (learned the hard way)

1. **Never freeze a screen without looking at its latest composite first.**
   Freezing a screen with unresolved material findings BURIES them: the gate
   stops looking, and the user rediscovers the drift by eye weeks later. If
   the audit flagged the route `fail`, either fix it before freezing or write
   the known gaps into the row's reason so the decision is explicit. A route
   whose last verdict was `blocked` (capture never succeeded) must NEVER be
   frozen: you would be freezing a screen nobody has ever verified. And a
   freeze only covers what the baselines showed: non-default tabs and
   sub-panels that were never captured are NOT covered by the freeze
   decision - they were never seen by anyone.
2. **Frozen screens can still regress silently** through shared CSS, shared
   partials, or theme token changes - the gate no longer watches them. To
   protect them, capture the implementation at freeze time into
   `{design-source}/impl-baselines/{ROUTE}.{viewport}.png` and add
   audit-mode regression pairs comparing the live implementation against
   that stored image:

   ```json
   {
     "id": "ADMIN_SETTINGS__REGRESSION",
     "baselineImage": "impl-baselines/ADMIN_SETTINGS.desktop.png",
     "impl": "http://127.0.0.1:8000/admin/settings",
     "session": "admin",
     "viewports": ["desktop"]
   }
   ```

   Any diff then means "something changed a frozen screen" - which is always
   worth a look, whatever the registry says about the prototype.

3. **Screens evolve epic by epic - the registry follows the lifecycle.**
   When a later epic adds features to an existing screen:
   - new feature drawn in the prototype -> normal gate on that screen (unfreeze
     it, or scope the freeze row: "whole screen outside the story X block");
   - new feature NOT drawn in the prototype -> `impl-only-feature` row,
     implemented with theme tokens, never blocked;
   - prototype feature not yet in scope (planned for a later epic) ->
     `proto-only-deferred` row + mask on that control, removed when its epic
     ships;
   - after ANY approved evolution of a frozen screen, RE-CAPTURE its
     impl-baseline (`impl-baselines/{ROUTE}.{viewport}.png`), otherwise the
     regression pair fires forever on the legitimate change. The registry row
     and the baseline must move together.
   Best practice when a screen changes a lot: update the prototype itself,
   recapture (new hash refreshes everything), and prune the rows the new
   baselines make obsolete - the prototype stays the reference instead of
   becoming an archive.

## Keeping the prototype honest

The registry absorbs drift; it does not replace design maintenance. When the
user updates the prototype to reflect accepted changes, recapture with
proto-design-source and delete the rows the new baselines make obsolete.
