# Prototype Parity Kit

## Author

Created and maintained by Jeremie PERERA.

Contributions are welcome under the MIT License.

Make an AI-driven delivery workflow (BMAD or similar) implement a UI that
actually matches a validated HTML prototype - by giving developers **extracted
code and pixels** instead of prose descriptions, and by gating every UI story
with a **visual side-by-side check**.

## Why this design

Earlier attempts at prototype fidelity fail in a predictable way: the prototype
gets *described* in ever-longer text contracts, an agent *re-generates* UI from
those descriptions, drift appears, and more rules get added to the contract.
Rule count grows, instruction-following degrades, and validation lands at the
end of an epic when rework is most expensive.

This kit inverts that:

| Instead of | The kit uses |
|---|---|
| Prose screen contracts | Baseline screenshots + rendered HTML fragments + design tokens extracted from the prototype |
| Re-generating UI from descriptions | Porting the prototype's own rendered markup into the project's template system |
| End-of-epic audit as main enforcement | A per-story visual gate; epic audit is a light sweep |
| A bespoke assertion runner | Side-by-side composite images + a pixel-mismatch triage signal, judged visually |

## Contents

```text
skills/
├── ppk-setup/               # registers the module and its help capabilities
├── proto-design-source/     # run once per prototype version: extract baselines,
│   ├── SKILL.md             # rendered HTML, tokens; bind stories to artifacts
│   ├── references/          # config schema + story-binding template
│   └── scripts/capture_baselines.mjs
└── proto-parity-check/      # per-story gate + epic/brownfield audit
    ├── SKILL.md
    ├── references/          # deviations-registry spec (freeze hygiene, lifecycle)
    └── scripts/parity_check.mjs
tools/                       # pinned Playwright manifest (npm ci)
LICENSE, CHANGELOG.md, INTEGRATION.md, PROMPTS.md
```

Each `scripts/` directory ships `tests/` runnable with `node --test`.

Both scripts need Node >= 18 and Playwright, resolved from (in order)
`$PARITY_TOOLS_DIR`, the current project, or a package manifest colocated with
the script. For a reproducible install, use the pinned manifest shipped in
`tools/` and export `PARITY_TOOLS_DIR`:

```bash
cp -R tools /path/to/your-project/tools/parity
cd /path/to/your-project/tools/parity && npm ci
npx playwright install chromium
export PARITY_TOOLS_DIR="$(pwd)"
```

The pinned Playwright version in `tools/package.json` is the one the kit was
validated against; `npx playwright install chromium` downloads the matching
browser build so captures are identical across machines.

## Tests

```bash
node --test skills/proto-design-source/scripts/tests/test-capture_baselines.mjs \
            skills/proto-parity-check/scripts/tests/test-parity_check.mjs
```

Covers the pure helpers (arg parsing, url/route resolution, threshold
classification) and verifies that both CLIs execute through symlinked paths.
Browser behavior is validated in the field by the gate itself - every capture
produces reviewable evidence.

## Install

Claude Code (project): `cp -R skills/* .claude/skills/`
Claude Code (global): `cp -R skills/* ~/.claude/skills/`
Codex / BMAD project skills: `cp -R skills/* .agents/skills/`

### Install as a BMad module

Install directly from this repository, then invoke `ppk-setup` once in the
target project to register the module configuration and its `bmad-help`
capabilities:

```bash
npx bmad-method install \
  --directory . \
  --modules bmm \
  --custom-source https://github.com/JeremieP69/bmad-prototype-parity-kit \
  --tools codex \
  --yes
```

## Workflow placement

```text
PRD -> UX -> Architecture -> Prototype (validated)
    -> proto-design-source            # once: baselines + rendered HTML + tokens
    -> Create Epics & Stories         # each UI story gets a Prototype Binding section
    -> Dev Story                      # dev directive: port the fragment, don't reinvent
    -> proto-parity-check (gate mode) # only pass / pass-with-approved-deviation routes can close
    -> Code Review
    -> Epic close: proto-parity-check (audit mode)  # light sweep, not the main gate
```

Brownfield (screens shipped before the kit): run `proto-parity-check` in audit
mode over all shipped routes, turn findings into per-screen correction stories,
then gate them normally.

See `INTEGRATION.md` for the exact snippets to add to your story-creation and
dev workflows, and `PROMPTS.md` for copy-paste prompts driving each mode.

## Quick start (5 minutes)

```bash
# 0. Where you installed the skills (pick the one matching your Install step):
SKILLS_DIR=.claude/skills   # Claude Code project
# SKILLS_DIR=.agents/skills # Codex / BMAD project

# 1. Install Playwright once (see above), then describe your prototype:
mkdir -p _bmad-output/design-source
cat > _bmad-output/design-source/proto.config.json <<'EOF'
{
  "prototype": "../../path/to/prototype.html",
  "navigation": { "mode": "hash" },
  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900 },
    { "name": "mobile", "width": 390, "height": 844 }
  ],
  "routes": ["HOME", "LOGIN"],
  "outDir": ".",
  "readySelector": "#root *",
  "renderedRootSelector": "#root"
}
EOF

# 2. Extract baselines + rendered HTML for every route:
node "$SKILLS_DIR"/proto-design-source/scripts/capture_baselines.mjs \
  --config _bmad-output/design-source/proto.config.json

# 3. Later, describe one prototype<->implementation pair...
cat > _bmad-output/design-source/parity.config.json <<'PARITY'
{
  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900 },
    { "name": "mobile", "width": 390, "height": 844 }
  ],
  "outDir": "parity-evidence",
  "implementation": { "sessions": { "anonymous": null } },
  "threshold": { "warnPct": 5, "failPct": 15 },
  "pairs": [
    {
      "id": "HOME",
      "proto": "../../path/to/prototype.html#HOME",
      "impl": "http://127.0.0.1:8000/",
      "session": "anonymous"
    }
  ]
}
PARITY

# 4. Initialize the durable deviations registry used by every verdict:
cat > _bmad-output/design-source/deviations.md <<'DEVIATIONS'
# Parity Deviations Registry

| Route | Viewport | Scope | Type | Decision & reason | Date | Status |
|---|---|---|---|---|---|---|
DEVIATIONS

# 5. Confirm the design source is fresh, then compare. Agent-driven use
# performs the same two-file bootstrap through the proto-parity-check skill:
node "$SKILLS_DIR"/proto-design-source/scripts/capture_baselines.mjs \
  --config _bmad-output/design-source/proto.config.json --check-stale && \
node "$SKILLS_DIR"/proto-parity-check/scripts/parity_check.mjs \
  --config _bmad-output/design-source/parity.config.json
```

Open `_bmad-output/design-source/baselines/` to see what your stories will bind
to, and `parity-evidence/*.compare.png` to judge parity.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Blank or default-route baselines | `readySelector` never matches or `waitMs` too short; SPA prototypes need the route in the URL (`hash`/`query` mode) - verify by opening `{prototype}#{ROUTE}` in a browser |
| `playwright not found` | Install per the setup above; scripts resolve from `$PARITY_TOOLS_DIR`, the current project, then a package manifest colocated with the script. Node >= 18 required |
| Prototype renders empty headless | The prototype loads libraries from a CDN (framework runtime, fonts): the machine needs network access during capture |
| Sticky/fixed bars appear mid-page in full-page shots | Known full-page-screenshot behavior with `position: fixed`; harmless for comparison since both sides capture the same way |
| High mismatch % on a correct screen | Different data (names, dates, counts) inflates the signal: add `mask` selectors for those regions, and always judge from the composite, not the number |
| Implementation server hangs or times out during captures | Single-threaded dev servers (PHP `php -S`, some `python -m http.server` setups) stall under Playwright's parallel asset requests. For PHP set `PHP_CLI_SERVER_WORKERS=8` before starting `php -S`, or use `symfony server:start`. Restart a long-lived server before big capture runs; a run that died mid-way produces invalid composites - re-run, never judge from partial captures |
| Gate fails only on colors everywhere | Check theme tokens first (`tokens.md`): one token mismatch shows up on every screen - fix or approve it once at theme level |

## Principles (the short version)

1. The prototype provides code and pixels; nobody re-describes a screen in text.
2. Parity is judged from side-by-side composite images, per route and viewport;
   the mismatch percentage only triages.
3. Desktop and mobile are separate verdicts.
4. Prototype example data is never product copy: classify values as
   `static_copy` / `example_data` / `production_data` in the story binding.
5. Click paths through the shell are primary evidence; direct URLs secondary.
6. Deviations exist only as recorded product decisions - durable ones live in
   the deviations registry (`design-source/deviations.md`), so intentional
   post-dev changes and prototype-missing features are respected by every
   future gate instead of being re-flagged or "fixed" back to the prototype.
7. The gate is per-story. Drift is fixed while the story is open.
8. The prototype is the starting contract, not a cage: implementations may
   legitimately evolve past it (manual-testing improvements, backend-imposed
   features). The registry absorbs that; update the prototype and recapture
   when you want it to be the reference again.

## License

MIT - see `LICENSE`.

## Version

v0.5.0 - see `CHANGELOG.md`: every rule in it comes from a real failure met
in field use (lenient judges, phantom passes, frozen-screen drift, hardcoded
example data, invisible tabs and overlays...). v0.3.0 superseded
`prototype-driven-bmad-delivery` + `agent-prototype-parity-auditor` (v0.2.0),
replacing prose contracts and the bespoke assertion runner with extracted
design source + visual gating.
