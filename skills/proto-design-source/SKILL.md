---
name: proto-design-source
description: Extracts versioned design evidence from prototypes. Use when the user says 'extract prototype baselines', 'refresh the prototype design source', or 'bind a UI story to the prototype'.
---

# Prototype Design Source

## Overview

Convert a browser-renderable prototype (standalone HTML, SPA, or served app) into
versioned design-source artifacts that UI stories bind to directly.

Principle: **the prototype provides code and pixels, not prose.** Never describe a
screen in text when you can attach its screenshot, its rendered HTML, and its tokens.

## On Activation

1. Load available project configuration from `{project-root}/_bmad/config.yaml`
   and `{project-root}/_bmad/config.user.yaml`, falling back to
   `{project-root}/_bmad/bmb/config.yaml`. Resolve `communication_language`
   from config or the conversation language, and `document_output_language`
   from config or the resolved communication language.
2. Resolve the output directory (default `_bmad-output/design-source/`).
3. If no prototype location is known, ask the user for it before anything
   else (see Inputs for accepted formats); if the project has no prototype,
   say so and stop - this skill does not apply.
4. Run `--check-stale` when a design source already exists: a changed hash
   means full recapture before any new binding.
5. Communicate in `communication_language`; write MANIFEST and token artifacts
   in `document_output_language`.

## Inputs

- `prototype`: file path or URL of the prototype.
- `routes`: list of prototype route/screen ids in scope (all routes on first run).
- `output_dir`: default `_bmad-output/design-source`.

If no prototype location is known, ask the user for it before doing anything
else. If the project has no prototype at all, say so and stop: this skill and
the parity gate simply do not apply (stories then follow UX specs directly).

Accepted prototype formats - anything a browser can render:

- a standalone HTML file (single-file SPA bundles included), opened via `file://`;
- a folder of HTML pages (point `prototype` at the entry page; use `path` or `click` navigation);
- a hosted URL: staging deploy, Vercel/Netlify preview, local dev server;
- design-tool exports only if exported to HTML (a Figma link or image mockups
  are not enough: there is no DOM to capture - export to HTML or rebuild the
  key screens as an HTML prototype first).

## Outputs

```text
{output_dir}/
├── proto.config.json          # capture config (routes, viewports, navigation mode)
├── MANIFEST.md                # route -> files table + prototype content hash
├── baselines/{ROUTE}.{viewport}.png
├── rendered/{ROUTE}.{viewport}.html   # DOM as actually rendered by the prototype
├── tokens.md                  # design tokens mapped to project CSS variables
└── screens/{ROUTE}.source.txt # on demand: authored source slice for one screen
```

## Workflow

### 1. Create or refresh `proto.config.json`

Discover route ids from the prototype source (route registry, screen map, or nav
targets) and confirm the list with the user if ambiguous. Record the navigation mode:

- `hash`: screens reachable via `{url}#{ROUTE_ID}` (most standalone SPA prototypes);
- `query` / `path`: reachable via query param or path;
- `click`: no addressable routes - record a click sequence per route in the config.

See `references/proto-config-schema.md` for the schema. Use the project's real
viewports; default `1440x900` desktop and `390x844` mobile.

### 2. Capture baselines and rendered HTML

```bash
node {skill_dir}/scripts/capture_baselines.mjs --config {output_dir}/proto.config.json
```

The script writes one full-page screenshot and one rendered-DOM HTML file per
route and viewport, plus `MANIFEST.md` with the prototype content hash. If the
hash changed since the last run, recapture everything; otherwise recapture only
new or explicitly requested routes.

To detect prototype changes without capturing, run the same command with
`--check-stale`: exit 0 = fresh, 3 = stale or never extracted, 4 = remote
prototype that cannot be hashed (ask the user whether it changed). Run this
check at every epic kickoff and before binding a new story; when stale,
recapture all routes, refresh `tokens.md`, and flag existing stories bound to
changed screens - their binding hash is outdated.

Verify the run: open 2-3 baselines and confirm they show the expected screen, not
a blank page or the default route (a wrong `readySelector` or too-short wait
produces silently wrong baselines).

**Overlays are captured states too.** For every modal, drawer, popin, bottom
sheet or confirmation the prototype opens, add an overlay pseudo-route to the
config (`base` route + `steps` that open it - see the schema reference) and
capture it at both viewports: prototypes commonly switch primitive per
breakpoint (modal on desktop, bottom sheet on mobile). A screen "with a
popin" is two deliverables: the page, and the open overlay - each with its
own baseline, rendered fragment, and later its own parity pair.

**Same rule for non-default tabs and sub-panels.** A route's baseline shows
only its DEFAULT state: every other tab, accordion section, or switchable
panel the prototype draws is invisible in it. Declare one pseudo-route per
scoped tab state (`base` route + a `steps` click on the tab label) - e.g. a
rules screen with 5 tabs is 5 capture states, not 1. A story that builds UI
inside a never-captured tab works blind and gates against nothing.

### 3. Extract design tokens (first run, then on prototype change)

Locate the token definitions in the prototype source (CSS custom properties, a JS
theme object, or repeated literal values). Write `tokens.md` as a table:

`token name | prototype value | project CSS variable | status (mapped / missing / mismatch)`

If the project already has a theme stylesheet, reconcile: every prototype token
must map to an existing project variable or be added to the project theme. A
`mismatch` row is a finding to fix in the project theme, not in each screen.

### 4. Slice screen source on demand

When a story needs a screen, extract that screen's authored source (the component
function, template block, or section) from the prototype into
`screens/{ROUTE}.source.txt`. Do not extract all screens upfront. The authored
source carries exact values (spacing, colors, conditional states) that the
rendered HTML may not show for every state.

### 5. Bind stories

When a UI story is created, add a `Prototype Binding` section from
`references/story-binding-template.md`. The binding points to the artifacts above;
it never re-describes the screen. The dev directive is always:

> Port the rendered HTML / source fragment into the project's template system,
> keeping exact structure and style values, mapped onto the shared theme tokens.
> Replace example data with real bindings. Any structural deviation requires an
> explicit product decision recorded in the story.

## Rules

- Baselines are immutable evidence: regenerate via the script, never edit.
- Re-run capture when the prototype file hash changes; note the new hash in stories bound to changed screens.
- Prototype example data (names, prices, categories) is never product copy: classify visible values as `static_copy`, `example_data`, or `production_data` in the story binding.
- If the prototype cannot render a state (error, empty, loading), say so in the binding and mark that state `no-prototype-source` instead of inventing a design.
