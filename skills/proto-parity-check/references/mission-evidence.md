# Scoped missions and visual evidence

Run the commands from the project root. Set `SKILLS_DIR` to `.agents/skills`,
`.claude/skills`, or the actual installation directory. No project-specific
port or route is imposed: use the application's real acceptance environment.
The prototype freshness preflight from SKILL.md remains required.

```bash
node "$SKILLS_DIR"/proto-parity-check/scripts/mission.mjs context \
  --config _bmad-output/design-source/parity.config.json --pairs HOME,LOGIN
node "$SKILLS_DIR"/proto-parity-check/scripts/mission.mjs capture \
  --config _bmad-output/design-source/parity.config.json --pairs HOME,LOGIN
```

`--pairs` is mandatory. Empty, unknown, wildcard or overlapping pair/viewport
selections fail explicitly. Repeated IDs with disjoint viewports are supported.
The command retains every configured viewport restriction; no coverage is
silently removed. `--out` chooses the run parent (default `tools/parity/runs`).
Each invocation creates a unique directory. Add `/tools/parity/runs/` to the
project's ignore rules; the bundled `tools/.gitignore` covers copied tools.

The context package contains filtered configs, MANIFEST.md, deviations.md and
context.json. Read these instead of the complete global files. Original source
paths, hashes and byte counts remain available for investigation. Prose,
ambiguous decisions, unknown scopes and wildcard rows remain conservatively;
only unambiguously unrelated table rows are omitted. Parent route decisions
are kept for scoped overlay/tab states. Byte counts are not token measurements.

The scripts still read complete source files. Public configs redact sessions,
credentials, fill values and sensitive URL query/fragment parameters while
retaining nonsecret routing parameters. Capture uses a private temporary engine
config, removed in a finally block. A forced kill can leave `.engine-config.json`:
remove it before sharing an interrupted run. Images may contain application
data. Keep evidence local and never publish project captures with this kit.

## Independent review

Every new or invalidated comparison must be opened and inspected. Explain its
hotspots, inspect layout, typography, primitives and responsive states. Verify
real navigation, interactions and overlays separately; none of these checks is
replaced by matching pixels. Respect approved and pending registry decisions.

Write one verdict for every comparison in the run, for example:

```json
[
  {"id":"HOME","viewport":"desktop","verdict":"PASS","reason":"Describe inspected regions and explain remaining hotspots.","inspected":true},
  {"id":"HOME","viewport":"mobile","verdict":"APPROVED_DEVIATION","reason":"Describe inspected regions and the approved difference.","decision":"deviations.md: relevant approved row","inspected":true}
]
```

Allowed verdicts: `PASS`, `FAIL`, `APPROVED_DEVIATION`. The latter requires a
nonempty decision reference. Recording requires an explicit independent reviewer,
distinct author, actual inspection and justification. Identity is an attestation,
not an authentication service. A mechanical signal alone is never a verdict.

```bash
node "$SKILLS_DIR"/proto-parity-check/scripts/mission.mjs record-review \
  --run <run-directory> --reviewer independent-reviewer --author implementer \
  --independent yes --verdicts /tmp/verdicts.json
node "$SKILLS_DIR"/proto-parity-check/scripts/mission.mjs capture \
  --config _bmad-output/design-source/parity.config.json --pairs HOME \
  --previous <reviewed-run-directory>
```

A fresh capture is always performed. Only identical composite bytes with an
intact favorable review and identical source/reference/configuration/engine/runtime
fingerprints become `REUSE_CANDIDATE`. The reviewer confirms candidates and
checks effects of intervening changes. All interactions remain `VERIFY_FRESH`;
the command never assigns a global PASS or copies verdicts automatically.
Unknown, missing, altered, failed or incompatible evidence requires inspection.
Hashes detect accidental alteration; they are not signatures resistant to
coordinated rewriting of both evidence and checksums.

## Runtime and provenance

The default engine is the neighboring `parity_check.mjs`, independent of the
installation directory. `--engine` explicitly selects another compatible engine.
`--proto-config`, `--manifest` and `--deviations` select nonstandard source paths.

Set `PARITY_TOOLS_DIR` to the existing Playwright package directory. Follow the
README installation instructions if dependencies have not been provisioned.
When an agent host already bundles Playwright, use that runtime instead of
installing another copy. To enable reuse, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the existing browser binary: that exact
binary is passed to the engine and fingerprinted. Implicit headless selection
is unknown, so captures still run but reuse is disabled. Local reference files
are fingerprinted; remote/unresolvable references also disable reuse without
blocking fresh capture. Pixel equality does not prove application-code or
interaction equivalence.

Failures expose only safe categories: `PLAYWRIGHT_UNAVAILABLE`,
`BROWSER_UNAVAILABLE`, `SERVER_UNAVAILABLE`, `CAPTURE_TIMEOUT`,
`AUTHENTICATION_FAILURE`, `REFERENCE_UNAVAILABLE`, `ENGINE_FAILURE`.
Do not seed or migrate acceptance data to bypass a failed capture.

## Tests

```bash
APP_ENV=test node --test skills/proto-parity-check/scripts/tests/test-mission.mjs
```

CLI tests use temporary fixtures and a simulated capture engine; they verify
filtering, secret removal, provenance invalidation, changed fresh images,
explicit review guards and runtime fingerprinting. They do not claim browser
parity or user acceptance. The simulated runtime marker is test-only.
