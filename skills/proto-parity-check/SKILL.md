---
name: proto-parity-check
description: Validates visual parity against prototype baselines. Use when the user says 'run the prototype parity gate', 'audit prototype parity', or 'check this screen against the prototype'.
---

# Prototype Parity Check

## Overview

Verify that implemented screens match their prototype baselines. Evidence is
visual (side-by-side composites), the verdict is yours, and the gate is
per-story - drift is caught while the story is still open, never at the end of
an epic only. Two modes: gate (end of every UI story) and audit (epic close or
brownfield catch-up).

## On Activation

1. Load available project configuration from `{project-root}/_bmad/config.yaml`
   and `{project-root}/_bmad/config.user.yaml`, falling back to
   `{project-root}/_bmad/bmb/config.yaml`. Resolve `communication_language`
   from config or the conversation language, and `document_output_language`
   from config or the resolved communication language.
2. Resolve the design-source directory (default
   `_bmad-output/design-source/`; ask if the project uses another location).
3. Load `parity.config.json` and the deviations registry (`deviations.md`)
   from it - the registry governs every verdict. **First use bootstraps
   them**: if `parity.config.json` is missing, create it with the
   design-source viewports, an `implementation.sessions` skeleton
   (`{"anonymous": null}` plus one entry per known role) and an empty
   `pairs` array; if `deviations.md` is missing, create it with the standard
   header and an empty table. Missing files are a setup step, not an error.
4. Communicate in `communication_language`; write generated reports in
   `document_output_language`.
5. If invoked without enough context, ask only for the missing blocker
   (story scope and its bound routes, or audit scope) - otherwise proceed
   autonomously under the loop contract in the rules below.

## Prerequisites

- `proto-design-source` artifacts exist (`_bmad-output/design-source/`).
- The implementation runs on a reachable URL with seeded data.
- `parity.config.json` maps prototype routes to implementation URLs (see below).

## Config

`{design-source dir}/parity.config.json`:

```json
{
  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900 },
    { "name": "mobile", "width": 390, "height": 844 }
  ],
  "outDir": "parity-evidence",
  "waitMs": 1000,
  "implementation": {
    "sessions": {
      "admin": { "url": "http://127.0.0.1:8000/login", "user": "admin@example.test", "password": "..." },
      "customer": { "url": "http://127.0.0.1:8000/login", "user": "client@example.test", "password": "..." },
      "anonymous": null
    }
  },
  "threshold": { "warnPct": 5, "failPct": 15 },
  "pairs": [
    {
      "id": "ADMIN_ORDERS",
      "proto": "file:///abs/path/prototype.html#ADMIN_ORDERS",
      "impl": "http://127.0.0.1:8000/admin/orders",
      "session": "admin",
      "mask": { "proto": [".demo-date"], "impl": [".real-date"] }
    },
    {
      "id": "APP_CHECKOUT",
      "proto": "file:///abs/path/prototype.html#APP_CHECKOUT",
      "impl": "http://127.0.0.1:8000/app/checkout",
      "session": "customer",
      "implSteps": [
        { "click": ".product-card >> nth=0" },
        { "click": "text=Continue" },
        { "click": ".shipping-option >> nth=0", "waitMs": 500 }
      ]
    }
  ]
}
```

Sessions: declare one entry per user role plus `anonymous: null` for public
pages; each pair picks its `session` (a plain `implementation.login` still
works as session `default`). `implSteps` / `protoSteps` reach states without an
addressable URL - wizard steps, role-guarded flows, opened drawers/modals -
via `click` / `fill` / `hover` / `scrollTo` / `check` / `goto` / `waitMs`
actions executed before the screenshot.

Additional pair options and CLI flags:

- `mask.collapse` (`{ "proto": [...], "impl": [...] }`): removes matching
  elements from layout (`display:none`) instead of drawing a mask box - for
  regions that must be excluded WITH their space (e.g. an annotation banner
  only the prototype has). Regular `mask` keeps the space and paints it.
- `protoScreenshotSelector` / `implScreenshotSelector`: capture only one
  element instead of the page - for component-scoped pairs.
- `baselineImage`: compare the live implementation against a stored PNG
  instead of the prototype (regression pairs for frozen screens); the probe
  refuses these pairs (no live prototype side to probe).
- `--report-name NAME`: suffix the report files (parallel runs, per-story
  evidence).
- `--strict`: exit code 3 when any pair ends above `warnPct` - use it in CI
  or scripted gates so a divergence can never look like a success.

Overlays get their own pairs: every modal, drawer, popin or bottom sheet
listed in the story's Prototype Binding is a separate pair whose `protoSteps`
and `implSteps` open it on both sides:

```json
{
  "id": "ADMIN_ORDER_DETAIL__CANCEL_CONFIRM",
  "proto": "file:///.../prototype.html#ADMIN_ORDER_DETAIL",
  "impl": "http://127.0.0.1:8000/admin/orders/{id}",
  "session": "admin",
  "protoSteps": [ { "click": "text=Cancel order", "waitMs": 400 } ],
  "implSteps": [ { "click": "text=Cancel order", "waitMs": 400 } ]
}
```

An overlay verdict is per viewport like any pair - and prototypes commonly
switch primitive per breakpoint (modal on desktop, bottom sheet on mobile),
so never let the desktop overlay verdict imply the mobile one. A story whose
binding lists overlays but whose config has no overlay pairs has an
incomplete gate - and a binding whose Overlays table is EMPTY while the
screen's source slice contains overlay triggers (add/edit/delete buttons,
drawer/modal calls) is invalid: enumerate them or state explicitly that the
fragment has none.

Backend feedback states (validation errors, success flashes, result screens):

- **Validation errors** are the easy pair: `implSteps` fill invalid values and
  submit - idempotent, repeatable, no side effect. Prefer them as the pixel
  pair for form feedback styling.
- **Success states mutate the database.** A pair whose steps submit a valid
  form creates real records, and the gate runs desktop THEN mobile: the
  second viewport must not fail (unique constraint, duplicate) or falsely
  pass because the first already mutated state. Use a resettable dedicated
  seed, or distinct seeded data per viewport - and reset between gate runs.
- **Auto-dismissing toasts**: keep `waitMs` shorter than the dismiss delay or
  the screenshot captures nothing.
- If the prototype never drew a feedback state the backend produces, it is
  `no-prototype-source`: style it with the theme's alert/flash components,
  note it in the binding, judge by hand - there is nothing to diff against.

Maintain this file incrementally: every UI story adds or updates its pairs. Use
`mask` to blank regions whose content is legitimately different (dates, random
seed data) so the mismatch signal stays meaningful. Keep the mismatch caused by
*data* out; keep the mismatch caused by *layout, spacing, color, typography,
component primitives* in.

## Gate mode (end of every UI story)

0. **Baseline freshness first**: run
   `node {design-source skill}/scripts/capture_baselines.mjs --config
   {dir}/proto.config.json --check-stale`. If it reports `stale` or
   `no-manifest`, the gate is `blocked` until the baselines are recaptured -
   never render a verdict against an outdated prototype. If it reports
   `unknown` (unhashable remote prototype), ask the user whether the
   prototype changed since the manifest date.
1. Load `{dir}/deviations.md` (see `references/deviations-registry.md`): approved
   rows are not findings; a route whose visible difference is covered by a
   `pending` row gets the explicit verdict `blocked-pending-decision` -
   neither fixed (the decision is not made) nor passed (the story cannot
   close on it); it resolves only when the user settles the row. Ensure each
   route in the story's `Prototype Binding` has a pair in the config.
2. Run:
   ```bash
   node {skill_dir}/scripts/parity_check.mjs --config {dir}/parity.config.json --pairs ROUTE1,ROUTE2
   ```
3. **Open every composite image** (`parity-evidence/{ROUTE}.{viewport}.compare.png`)
   and judge it. The mismatch percentage is triage, not a verdict:
   - `close` composites still need one look (a wrong color can be < 1%);
   - high percentages caused only by different data/text length can pass;
   - any difference in structure, spacing, color, typography, control primitive,
     action placement, or responsive layout is a finding.

   Judge protocol (mandatory, per composite):
   - the report lists **hotspots** (`y` ranges concentrating the mismatch,
     orange markers on the diff panel): explain EVERY hotspot as either
     data-to-mask, an approved deviation, or a named finding - an unexplained
     hotspot blocks the verdict;
   - **delta rule**: compare each pair's percentage with the previous run;
     a pair whose percentage did not move was NOT fixed, whatever the change
     summary claims - re-open its findings;
   - judge with fresh eyes: run the judgment as a distinct pass (ideally a
     different session/agent than the one that wrote the fix), reading only
     the composite, the hotspots, and the registry - not the fixer's summary;
   - **do not chase 0%**: with live data a perfectly aligned screen rarely
     reaches 0. Once the pair is below `warnPct` AND every remaining hotspot
     is explained (data-to-mask or approved deviation), record `pass` and
     stop iterating on it - further pixel-chasing (or mask-widening to force
     the number down) is waste. The converse also holds: a low percentage
     NEVER passes by itself - a missing CTA or a wrong brand color can sit
     under 1%.
4. Additionally verify by hand, per route (composites cannot see these):
   - the user-visible click path from the shell/menu reaches the screen (direct
     URL success alone is not parity);
   - overlays the prototype shows (modal, drawer, bottom sheet, confirmation)
     open with the same primitive and placement;
   - interactive states in scope: selected, disabled, error, empty;
   - dependent controls listed in the binding actually scope their options on
     parent change (e.g. city options limited to the selected country) and
     clear stale selections;
   - derived fields listed in the binding actually recompute when their
     inputs change (e.g. computed total = quantity x unit price) - a frozen
     example value is a FAIL even though the static screenshot matches;
   - anchors listed in the binding land on the right section with the
     prototype's offset (add a fullPage:false pair with a click/scrollTo step
     when the landed view deserves mechanical comparison);
   - reveals (accordion, tooltip, hover, appear-on-scroll) show the right end
     state - capture it via steps when scoped - and the motion itself
     (present/absent, roughly similar feel) is a by-hand judgment: pixel
     screenshots cannot see duration or easing;
   - **hardcode detector**: hardcoding the prototype's example data is the
     perfect crime against a pixel gate - the composite matches BETTER, not
     worse. For every region classified `example_data` or `production_data`
     in the binding, load the screen under a SECOND seed (different user,
     or the empty-state seed): content that stays identical across two seeds
     is hardcoded - automatic FAIL, whatever the mismatch percentage says.
     Regions matching the prototype's sample values verbatim (same names,
     same dates, same amounts as the proto) under a seed that does not
     contain them are the smoking gun.
5. Write the verdict into the story (or its validation file): per route and
   viewport, one of `pass` / `pass-with-approved-deviation` / `fail` /
   `blocked` (environment or stale baselines) /
   `blocked-pending-decision` (difference covered by a pending registry
   row), plus the findings list.
   A verdict must be auditable: name the regions compared (shell, header,
   card anatomy, controls, actions, banners, states), and map EVERY visible
   difference to exactly one of: a fix task, a deviation row in the registry,
   or a data mask in the config. "Looks close" or "remaining signal is data"
   without that mapping is not a verdict. `pass-with-approved-deviation`
   REQUIRES the registry row to exist - if it is not in deviations.md, the
   verdict is `fail`.
6. The story stays OPEN while any route x viewport is `fail`, `blocked` or
   `blocked-pending-decision` - only `pass` and
   `pass-with-approved-deviation` close a route. Fix fails and re-run the
   same pairs; unblock environments yourself; pending decisions resolve only
   through the user.
7. Iterate autonomously: repeat fix -> capture -> judge in the same session
   until every pair passes. Do not stop to report intermediate progress.
   Environment failures are yours to fix first (restart a hung dev server -
   for PHP use `PHP_CLI_SERVER_WORKERS=8`, re-run migrations/seeds, rebuild
   stale assets). Stop with the story open only for (a) a decision only the
   user can make, (b) an environment failure that persists after you tried to
   fix it, or (c) a stall (rule 8) - and say which one it is.
8. Root-cause and stall rules (spacing/offset findings especially):
   - **Fix the topmost hotspot first.** Vertical offsets cascade: one
     oversized text or widened block pushes everything below it, so lower
     hotspots are often symptoms, not causes. Never tune margins below an
     unexplained hotspot above.
   - **After 2 failed attempts on the same hotspot, stop editing blindly**
     and run the style probe on the first differing element in that band:
     `node {skill_dir}/scripts/parity_check.mjs --config {cfg} --probe
     PAIR_ID --selector ".element" [--impl-selector ".other"] [--viewport
     mobile]`. It prints computed typography, box metrics, spacing and rect
     for both sides with DIFF markers - the root cause is usually ONE
     upstream property (font-size, line-height, font-family fallback, width),
     not the margins you were nudging.
   - **Stall stop:** after 3 iterations on the same route x viewport without
     the mismatch dropping by at least 2 points, park the story: record the
     probe output, your root-cause hypothesis, and the exact question for the
     user. Endless margin-nudging wastes a night; an honest diagnostic does
     not.

## Audit mode (end of epic, or brownfield catch-up)

Use when screens shipped before this kit existed, or as an epic-close sweep.

0. Run the same baseline freshness preflight as gate mode before any audit
   capture. `stale` or `no-manifest` blocks the audit until recapture;
   `unknown` requires user confirmation before proceeding.
1. Build pairs for every prototype route in scope (whole epic, or the entire
   route list for a full brownfield audit). Load the deviations registry first;
   `impl-canonical` routes skip pixel comparison (click-path check only).
2. For an epic-scoped audit, run the script with `--pairs` limited to the
   epic's routes. Omit `--pairs` only for an intentional full-config or
   brownfield audit. Review every resulting composite as in gate mode.
3. Produce a gap report at `{outDir}/parity-gap-report.md`: one row per
   route x viewport with signal, verdict, and findings ranked by severity
   (broken navigation/primitive > layout/hierarchy > spacing/color > copy).
4. Convert findings into correction stories, grouped by screen (one story per
   screen or tight screen group - not one giant realignment story). Each
   correction story gets a normal `Prototype Binding` and passes gate mode like
   any other story.

## Rules

- Judge from the composite images, never from the mismatch number alone; say in
  the verdict what you looked at.
- Desktop and mobile are separate verdicts; one never implies the other.
- The prototype is the starting contract, not a cage. NEVER revert an
  implementation change to match the prototype without checking the deviations
  registry; if a difference looks intentional but has no registry row, ask the
  user instead of "fixing" it.
- A feature the implementation needs but the prototype never drew is not a
  parity failure: implement it with the shared theme tokens and the closest
  prototype patterns, record it once as `impl-only-feature` in the registry,
  and move on - the user restyles by hand if they want.
- When the user changes the implementation on purpose (after manual testing),
  add an `impl-improvement` (or screen-level `impl-canonical`) registry row so
  every future gate and audit respects it.
- If capture fails (auth, server down, stale assets), the gate is `blocked`, not
  passed. Compiled-asset staleness counts: verify against the same server URL a
  user would hit.
- Never edit baselines or composites by hand; regenerate via scripts.
- Keep evidence under the configured `outDir`; it is disposable and
  regenerable, unlike `baselines/` which is the reference.
