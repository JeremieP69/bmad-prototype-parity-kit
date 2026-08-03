# Copy-Paste Prompts

Ready-to-use prompts for driving the kit from any agent (Claude Code, Codex,
or a BMAD workflow). Adapt paths and language to your project.

## 1. Initial extraction (once per prototype version)

```text
Run the proto-design-source skill on our validated prototype at
{path/to/prototype.html}.

1. Create {output_dir}/proto.config.json: discover every route/screen id from
   the prototype source, confirm the navigation mode (hash/query/path/click),
   and use viewports {1440x900, 390x844}. For SPA prototypes set
   renderedRootSelector to the app mount point (e.g. "#root").
2. Run the capture script for all routes and verify 2-3 baselines visually
   (not blank, not the default route).
3. Extract the design tokens from the prototype source into tokens.md and
   reconcile them with our project theme stylesheet: map every token to an
   existing variable, flag missing or mismatching values as findings.
```

## 2. Story gate (end of every UI story)

```text
Run the proto-parity-check skill in gate mode for story {STORY_ID}.

0. Preflight: run capture_baselines.mjs --check-stale - stale or missing
   baselines block the gate until recapture; never judge against an
   outdated prototype.
1. Add or refresh this story's pairs in parity.config.json
   (routes: {ROUTE_IDS}), with masks for legitimately different data.
   Bootstrap parity.config.json and deviations.md if they do not exist yet.
2. Start the local server with seeded data, then run the parity script for
   those pairs only.
3. Load design-source/deviations.md first, then open and judge EVERY
   composite image. Approved registry rows are not findings; pending rows are
   surfaced once, never counted as fail; impl-canonical routes skip pixel
   comparison. The mismatch % is triage only: ignore data-driven differences,
   report structure, spacing, color, typography, component primitives, action
   placement, and responsive layout. Never revert an intentional
   implementation change toward the prototype.
4. Verify by hand: the click path from the shell/menu reaches each route, and
   overlays use the prototype's primitive (modal/drawer/bottom sheet).
5. Record a verdict per route x viewport in the story: pass /
   pass-with-approved-deviation / fail / blocked (environment or stale
   baselines) / blocked-pending-decision (covered by a pending registry
   row). fail, blocked AND blocked-pending-decision all keep the story
   open - only the two pass verdicts close a route. Fix every fail and
   re-run before marking the story done.

Loop contract: repeat fix -> capture -> judge until every pair passes, in
this same session, without stopping to report progress. Fix environment
failures (hung server, migrations, seeds) yourself before stopping. Only
stop early for a decision that is mine to make, or a blocker that survived
your own fix attempt - and tell me which one it is.
```

## 3. Epic-close sweep or brownfield catch-up

```text
Run the proto-parity-check skill in audit mode over {scope: this epic's routes
/ all shipped routes}.

0. Preflight: run capture_baselines.mjs --check-stale before any audit
   capture. Stale or missing baselines block the audit until recapture; an
   unhashable remote prototype requires user confirmation before proceeding.
1. Prepare parity.config.json: fill implementation.login with a seeded user,
   replace parameterized URLs with real seeded ids, and add pairs for every
   implemented route in scope (cross-reference design-source/MANIFEST.md with
   the app's route table).
2. Start the local server with the seeded database. For an epic scope, run the
   parity script with --pairs limited to that epic's routes; omit --pairs only
   for an intentional full-project or brownfield audit.
3. Load design-source/deviations.md, then judge every composite as in gate
   mode (desktop AND mobile separately): approved rows are not findings,
   pending rows make the route blocked-pending-decision, impl-canonical
   routes get click-path checks only.
4. Write parity-evidence/parity-gap-report.md: one row per route x viewport,
   verdict + findings, ranked by severity: broken navigation/primitive >
   layout/hierarchy > spacing/color > copy.
5. Convert material findings into correction stories - one per screen or tight
   screen group, each with its own Prototype Binding section. No catch-all
   "realign the whole UI" story.

Do not modify product code during the audit: only config, evidence, the
report, and the correction stories. Record known token-level deviations as
"pending product decision" instead of repeating them as findings on every
screen.
```

## 4. Overnight epic run (unattended)

Preconditions: permissive command-approval mode for this project, dev server
running multi-worker (PHP: `PHP_CLI_SERVER_WORKERS=8`), database migrated and
seeded, parity.config.json pairs/sessions ready for the epic's routes.

```text
Dev epic {N} end-to-end, unattended. For each story in order: create it with
its Prototype Binding, implement by porting the design-source fragments, then
run the parity gate in a loop (fix -> capture -> explain every hotspot ->
delta rule -> re-fix) until every route x viewport passes.

If a story hits a decision that is mine (deviation approval, ambiguous data
source): park THAT story with the question stated, and continue with the next
story - never guess, never stop the whole run for it.

Fix environment failures yourself (hung server, migrations, seeds, assets)
before parking anything.

End-of-run report: per story - verdict per route x viewport; parked questions
(one line each, answerable yes/no where possible); pending registry rows
awaiting my approval; the exact click-paths I should test by hand, ranked by
risk; and the before/after mismatch percentages proving each screen moved.
```

Morning routine for the human: answer parked questions, approve/refuse pending
registry rows, glance at the composites of passed screens (you are the
fresh-eyes judge), and click through the listed paths - the gate proves pixels
and navigation, not interaction feel.

## Tips

- First time on a large scope? Limit the audit to one epic's routes to
  validate the mechanics (~10 screens) before the full sweep.
- If a known theme-level deviation exists (e.g. status colors darkened for
  accessibility), say so in the prompt ("approved deviation") so it isn't
  reported on every badge.
