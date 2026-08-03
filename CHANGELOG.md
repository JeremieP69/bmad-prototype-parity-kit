# Changelog

Every rule below exists because a real agentic-workflow failure produced it
during weeks of field use on a production server-rendered web application,
built epic by epic against a standalone SPA prototype. You get the rules without paying for the bugs.

## v0.4.4 (2026-08-03) - portable execution & closure consistency

Fourth independent release audit fixes the final distribution blockers:

- Both Node CLIs canonicalize their entry paths before deciding whether to
  execute `main()`. Invoking through a symlink or macOS `/tmp` alias can no
  longer return a false-success exit 0 without running the command.
- Subprocess regression tests invoke each CLI through a symlink and verify
  that its help output is produced.
- README quick start initializes both `parity.config.json` and
  `deviations.md`, then verifies baseline freshness before the first gate.
- README, the story-binding template, and BMAD integration now share one
  closure invariant: only `pass` and `pass-with-approved-deviation` close a
  route; pending decisions always block completion.
- Skill descriptions use the BMAD summary-plus-quoted-trigger convention,
  and activation resolves standard BMAD language configuration with safe
  fallbacks.
- Epic-scoped audits use `--pairs`; omitting it is reserved for intentional
  full-project or brownfield sweeps.

## v0.4.3 (2026-08-02) - documentation propagation & clean archive

Third independent release audit, three blockers fixed:

- Archive rebuilt without Apple metadata (`._*` AppleDouble files,
  `com.apple.provenance` attributes) via `COPYFILE_DISABLE` +
  `--no-mac-metadata --no-xattrs`.
- Quick start now creates a working `parity.config.json` before invoking the
  gate script - a new user's first run succeeds instead of erroring on a
  missing config.
- `PROMPTS.md` and `INTEGRATION.md` propagate the v0.4.2 rules they were
  missing: `--check-stale` preflight before any verdict, the full verdict set
  including `blocked` and `blocked-pending-decision`, and the explicit rule
  that fail, blocked AND blocked-pending-decision all keep the story open -
  a pending decision can no longer slip through story closure via the prompt
  or workflow-snippet path.
- Frontmatter descriptions restructured per BMAD convention: short summary
  first, then explicit `Use when` triggers.

## v0.4.2 (2026-08-02) - BMAD release readiness

Second independent release audit, five blockers fixed:

- **Gate checks baseline freshness itself**: gate mode now opens with
  `capture_baselines.mjs --check-stale`; stale or never-captured baselines
  block the verdict instead of silently judging against an outdated
  prototype.
- **Explicit verdict for pending deviations**: `blocked-pending-decision` -
  a route covered by a `pending` registry row is neither failed (the
  decision is not made) nor passed (the story cannot close); the full
  verdict set is pass / pass-with-approved-deviation / fail / blocked /
  blocked-pending-decision.
- **First-use bootstrap**: missing `parity.config.json` or `deviations.md`
  are created (viewports + sessions skeleton + empty pairs; standard
  registry header) instead of being assumed.
- README quick start uses a `SKILLS_DIR` variable consistent with every
  install target (`.claude/skills` / `.agents/skills`).
- `proto-only-deferred` added to the official deviation-type list (it was
  used by the lifecycle section but missing from the enumeration).

Also: `tools/package-lock.json` + `npm ci` for fully reproducible installs,
and skill descriptions rewritten in the BMAD `Use when...` convention.

## v0.4.1 (2026-08-02) - distribution hardening

Release-review fixes (thanks to an independent agent audit of the v0.4.0
archive):

- **Adopted the field-evolved gate script** - the packaged `parity_check.mjs`
  had fallen behind the copy hardened in production use. Recovered features:
  `goto` and `check` step types, `mask.collapse` (layout-removing exclusions),
  `protoScreenshotSelector`/`implScreenshotSelector` (element-scoped
  captures), `--report-name` (suffixed reports), `--strict` (non-zero exit on
  divergence - CI-safe), probe guard for `baselineImage` pairs. All documented
  in the SKILL.
- Neutralized every project-specific example (routes, labels, domain copy)
  into a generic order/checkout domain.
- Added automated tests for both scripts' pure helpers (`node --test`), with
  exported helpers to keep them testable.
- Added `LICENSE` (MIT) and a pinned `tools/package.json` for reproducible
  Playwright installs.
- BMAD skill-format conformity: `Overview` and `On Activation` sections in
  both SKILL.md files.
- Archive rebuilt with generic ownership metadata.

Lesson worth keeping: kit-to-project syncing must be two-way - field use
improves the scripts, and the package must recover those improvements before
each release (a checksum diff against the installed copy is the cheap check).

## v0.4.0 (2026-07-17)

### Convergence & judgment (failure: lenient verdicts, phantom passes, endless margin-nudging)
- **Hotspots**: the diff reports the y-ranges concentrating the mismatch
  (orange markers on the composite) - findings localize mechanically.
- **Judge protocol**: every hotspot must end explained (data mask / registry
  deviation / named finding); verdicts must name the regions compared;
  `pass-with-approved-deviation` requires the registry row to exist.
- **Delta rule**: a pair whose percentage did not move between runs was not
  fixed, whatever the change summary claims - catches phantom passes.
- **No pixel-chasing**: below `warnPct` with every hotspot explained = pass;
  never chase 0% (live data floors the score) - and a low % never
  auto-passes (a missing CTA sits under 1%).
- **Style probe** (`--probe PAIR --selector`): numeric computed-style/rect
  diff of one element on both sides - finds the ONE upstream property
  (font-size, width) behind cascade offsets instead of nudging margins.
- **Stall stop**: 3 iterations without a 2-point drop parks the story with
  the probe output and a root-cause hypothesis.
- Fix the topmost hotspot first: vertical offsets cascade downward.

### Autonomy (failure: agent stops to report between passes, or grinds all night)
- **Loop contract**: iterate fix -> capture -> judge in-session; four defined
  exits only - pass, user-only decision (park the story, continue others),
  persistent environment failure after self-repair, stall.
- Environment self-repair: restart hung dev servers
  (`PHP_CLI_SERVER_WORKERS=8` for single-threaded `php -S`), migrations,
  seeds, stale assets - before stopping.
- Overnight-run prompt with morning-report contract (PROMPTS.md §4).

### Capture coverage (failure: whole surfaces invisible to the gate)
- **Named sessions** (`implementation.sessions`: admin/customer/anonymous…),
  per-pair `session` - multi-role apps gate in one config.
- **Steps**: `click` / `fill` / `hover` / `scrollTo` / `waitMs` on both sides -
  wizard states, role-guarded flows, tooltips, anchor landings.
- **Overlays are captured states**: pseudo-routes (`base` + `steps`) per
  modal/drawer/popin/bottom sheet, at BOTH viewports (prototypes switch
  primitive per breakpoint) - and **enumeration is mandatory**: scan the
  fragment for triggers; an empty Overlays table needs the explicit statement
  "no overlay trigger found".
- **Non-default tabs and sub-panels are captured states too**: a 5-tab screen
  is 5 capture states, not 1.
- Anchors: `fullPage: false` pairs capture the landed viewport.
- `--check-stale`: hash-based prototype-change detection (exit 0/3/4), wired
  into epic kickoff, story creation and dev preflight.
- `renderedRootSelector`: rendered-DOM fragments contain only the app markup.

### Source-of-truth lifecycle (failure: freeze buried known findings; screens evolve epic by epic)
- **Deviations registry** (`design-source/deviations.md`): durable, typed rows
  (impl-improvement / impl-only-feature / token-adjustment /
  proto-example-data / proto-only-deferred / impl-canonical), statuses
  approved/pending; the gate loads it before judging; agents never revert an
  intentional implementation change toward the prototype.
- **Freeze hygiene**: never freeze without checking the latest composite;
  never freeze a `blocked` (never-verified) route; a freeze only covers what
  its baselines showed; capture `impl-baselines/` at freeze time and add
  `baselineImage` regression pairs so frozen screens cannot drift silently;
  re-capture the baseline after any approved evolution.
- **Screen-evolution lifecycle**: scoped punctual unfreezes ("whole screen
  outside the story X block"), `proto-only-deferred` masks for prototype
  features shipping in later epics, prune rows when the prototype itself is
  updated and recaptured.
- **Check-proto-first**: before any `impl-only-feature` row, scan the
  prototype screen INCLUDING non-default tabs/sub-panels/overlays for an
  existing pattern serving the need - a never-captured prototype tab is not
  a missing feature.

### Behavior guards (failure: same pixels, different product)
- **Interactions section** in the story binding: dependent controls (parent ->
  child scoping, stale-selection reset), derived fields (rule, not frozen
  example values), anchors, reveals - each with a by-hand gate check.
- **Two-seed hardcode detector**: hardcoding the prototype's example data is
  the perfect crime against a pixel gate (the composite matches BETTER);
  regions classified example/production data must differ under a second seed
  - identical content across seeds = automatic FAIL.
- **Backend feedback states**: validation errors are the idempotent pixel
  pair; success states mutate the DB (resettable seeds, distinct data per
  viewport); auto-dismissing toasts need `waitMs` below the dismiss delay;
  states the prototype never drew are `no-prototype-source`, styled with
  theme tokens, judged by hand.

### BMAD wiring
- Epic planning requires the design source (asks for the prototype location;
  "no prototype" opt-out recorded project-wide) and mandates a final parity
  consolidation story per UI epic.
- Staleness checks at sprint planning (auto + explicit user question), story
  creation (silent) and dev preflight (binding hash vs manifest).

## v0.3.0 (2026-07-09)

Initial release. Replaces prose screen contracts and bespoke assertion
runners with: design-source extraction (per-route baselines + rendered HTML
fragments + design tokens), story Prototype Bindings, and a visual parity
gate producing side-by-side composites judged per route x viewport.
