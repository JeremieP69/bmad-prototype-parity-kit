# BMAD Integration Guide

How to wire the kit into a BMAD-style delivery workflow. Four touch points:
epic planning, story creation, dev story, epic close. Each is a small
replacement, not an addition - if you previously used prose screen contracts,
navigation graphs, or a bespoke visual-assertion runner, **remove those hooks**
when adding these.

## 0. One-time setup (per project)

1. Install both skills (see README).
2. Install Playwright once (README, `PARITY_TOOLS_DIR`).
3. Run `proto-design-source` on the validated prototype: creates
   `_bmad-output/design-source/` with `proto.config.json`, baselines, rendered
   HTML, `MANIFEST.md`, and `tokens.md`.
4. Run `proto-parity-check` once to bootstrap both
   `_bmad-output/design-source/parity.config.json` and
   `_bmad-output/design-source/deviations.md`. Complete the implementation's
   login and seed conventions in the config; pairs are added story by story.

## 1. Epic planning (`create-epics-and-stories`)

Add to the prerequisites-validation step, alongside PRD/Architecture/UX checks:

```markdown
4. **Design source** (if UI exists) - `_bmad-output/design-source/` with
   MANIFEST.md, baselines and tokens produced by the proto-design-source skill.
   If the project has a UI but no design source exists, ask the user where the
   validated prototype lives (standalone HTML file, prototype folder, or hosted
   URL - anything a browser can render) and run proto-design-source BEFORE
   creating UI epics. If the project genuinely has no prototype, record
   "no prototype" and skip prototype parity gating project-wide.
```

Add to the story-breakdown guidance:

```markdown
- For UI-bearing epics with a design source: each UI story will receive a
  Prototype Binding at story-creation time, and the epic's LAST story must be
  a parity consolidation story whose acceptance criteria run proto-parity-check
  in audit mode over every route the epic touched and close or approve all
  remaining material findings before epic signoff.
```

## 1.5 Epic kickoff / sprint planning

At the start of each epic (or sprint-planning run) that contains UI stories,
combine an automatic check with an explicit question:

```xml
<check if="design-source exists and the sprint contains UI-bearing stories">
  <action>Run: node {skill_dir}/scripts/capture_baselines.mjs
  --config {dir}/proto.config.json --check-stale
  (exit 0 fresh / 3 stale / 4 unhashable-remote)</action>
  <ask>Ask the user: "Has the prototype changed since the last extraction?"
  and report the automatic check result.</ask>
  <action>If the user says yes OR the check reports stale: re-run
  proto-design-source (full recapture, refresh tokens and MANIFEST) BEFORE
  planning, then flag every already-written story bound to changed routes -
  their binding hash is outdated.</action>
</check>
```

The hash check catches silent edits the user forgot about; the question
catches remote prototypes the hash cannot see. Use both.

## 2. Story creation (`create-story`)

Also run the staleness check silently before binding (same command as above;
on stale, recapture before writing the binding). Then add two instructions to
the story-creation workflow:

```xml
<action>If the story touches prototype-backed UI, add a "Prototype Binding"
section using proto-design-source/references/story-binding-template.md.
Resolve the route ids from design-source/MANIFEST.md. If a needed screen or
state has no baseline, run the capture for it first (or mark the state
"no-prototype-source" with a product decision). A UI story without a
Prototype Binding is not ready-for-dev.</action>
<action>If design-source/ does not exist at all for a UI-bearing story: ask
the user where the validated prototype lives and run proto-design-source
first. If the user confirms the project has no prototype, record "Prototype
Binding: no prototype for this project" in the story and skip parity gating
for it.</action>
<action>When writing a Prototype Binding, check design-source/deviations.md
for the bound routes and copy relevant rows into the binding: impl-canonical
means the current implementation is the visual reference (never realign it
to the prototype; gate = click-path only); approved rows are pre-approved;
pending rows are open questions. Do not write parity acceptance criteria
that contradict the registry.</action>
```

## 3. Dev story (`dev-story`)

Replace any existing prototype-parity preflight/postflight steps with:

```xml
<step n="X" goal="Prototype-bound UI implementation">
  <check if="story has a Prototype Binding section">
    <action>Verify the story's binding hash matches the current MANIFEST hash
    (capture_baselines.mjs --check-stale). If they differ, the prototype
    changed after the story was written: recapture the bound routes, update
    the binding, and tell the user which screens changed.</action>
    <action>Before writing UI code: open the baseline PNGs and the rendered
    HTML fragment for every bound route and viewport. Slice the authored
    source for the screen into design-source/screens/{ROUTE}.source.txt if
    not already done.</action>
    <action>Implement by porting the rendered fragment into the project's
    template system: same structure, spacing, colors, and component
    primitives, mapped onto the shared theme tokens (design-source/tokens.md).
    Replace example data with real bindings per the story's data
    classification. Do not redesign; record any needed deviation as a
    question before coding it.</action>
    <action>If a task requires UI the prototype never drew (backend-imposed
    field, control, screen): do NOT block - implement it with the shared
    theme tokens and closest prototype patterns, record it once as
    impl-only-feature in design-source/deviations.md. If an existing surface
    differs from the prototype in a way that looks intentional, check the
    registry first and ask the user if no row exists - never revert an
    intentional change toward the prototype.</action>
    <action>After implementation: run capture_baselines.mjs --check-stale
    first (stale baselines block the gate), bootstrap parity.config.json and
    deviations.md if missing, add/refresh this story's pairs, then run
    proto-parity-check in gate mode. Load design-source/deviations.md before
    judging (approved rows are not findings; pending rows make the route
    blocked-pending-decision; impl-canonical routes skip pixel comparison).
    Review every composite. Record a verdict per route x viewport: fail,
    blocked and blocked-pending-decision ALL keep the story open - only
    pass and pass-with-approved-deviation close a route.</action>
    <critical>Iterate fix -> capture -> judge autonomously until every pair
    passes; do not stop to report intermediate progress. Fix environment
    failures yourself first (hung dev server, migrations, seeds, stale
    assets). Stop with the story open only for a user-only decision or a
    persistent environment failure - and say which.</critical>
  </check>
</step>
```

Checklist replacement (drop prose-contract items):

```markdown
## Prototype Parity (UI-bearing stories)
- [ ] Prototype Binding section present, artifacts exist for every bound route
- [ ] Implementation ported from rendered fragment / source slice, tokens mapped
- [ ] proto-parity-check gate ran after the last code change; composites reviewed
- [ ] Verdict recorded per route x viewport (desktop AND mobile)
- [ ] Click path from shell/menu verified by hand; overlays use prototype primitives
- [ ] No route left in fail, blocked or blocked-pending-decision (all three keep the story open); every pass-with-approved-deviation has an approved registry row
```

## 4. Epic close / retrospective

```xml
<action>For UI-bearing epics, run capture_baselines.mjs --check-stale before
any audit capture; stale or missing baselines block until recapture, and an
unhashable remote requires user confirmation. Run proto-parity-check in audit
mode with --pairs listing exactly the routes the epic touched (omit --pairs
only for an intentional full-project or brownfield audit). Review composites,
write the gap report, and convert material findings into per-screen correction
stories. Epic signoff requires every route x viewport to be pass or
pass-with-approved-deviation; fail, blocked and blocked-pending-decision all
block signoff.</action>
```

## Brownfield catch-up (screens shipped before the kit)

1. Run `proto-design-source` for all routes (baselines for everything).
2. Build `parity.config.json` pairs for every shipped route.
3. Run audit mode; review composites; write the gap report ranked by severity
   (navigation/primitive breaks > layout/hierarchy > spacing/color > copy).
4. Create one correction story per screen or tight screen group, each with a
   normal Prototype Binding, gated like any new story.

## Migrating from prototype-driven-bmad-delivery v0.2.x

| v0.2.x artifact | v0.3 replacement |
|---|---|
| Prototype Navigation Graph | Click path line in the story's Prototype Binding |
| Screen contracts / control primitive maps / style snapshots (prose) | Rendered HTML fragment + baseline PNGs + tokens.md |
| `prototype_visual_gate.mjs` JSON assertion contracts | Composite review via `parity_check.mjs` + human/agent verdict |
| `agent-prototype-parity-auditor` end-of-epic audit | `proto-parity-check` audit mode (light sweep; the per-story gate does the heavy lifting) |
| Story-surface coverage matrix | Route x viewport verdict table in the story |

Keep from v0.2.x (already folded into the new SKILL.md rules): click-path
primacy, desktop+mobile as separate verdicts, data-source classification,
deviations as product decisions.
