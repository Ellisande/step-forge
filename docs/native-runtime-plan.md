# Native Bun Runtime — Plan & Status

Building Step Forge's own test runtime to replace Vitest: TypeScript-native,
speed-focused, Cucumber-like run semantics. **Bun is the execution engine** (for
native `.ts` execution — the one hard Bun dependency we accept); everything else
is written against `node:*` APIs so the code stays Node-portable. We do **not**
build on `bun:test` — we own the run semantics and Cucumber-style output.

## Status: Phase 1 complete (functional replacement, additive)

Nothing existing was removed — the Vitest path still passes (`25 passed, 1
skipped`) so we can flip over deliberately later.

New modules under `src/runtime/`:

| File              | Role                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `cli.ts`          | `#!/usr/bin/env bun` entry — `node:util` `parseArgs`, flags, exit codes                   |
| `config.ts`       | loads `step-forge.config.ts` natively, merges CLI overrides, defaults                     |
| `runner.ts`       | discover → import steps → parse → compile-once → filter → concurrency-capped run → report |
| `filter.ts`       | dependency-free Cucumber tag-expression evaluator + name / `@only` / `@skip`              |
| `reporters.ts`    | `pretty` (Cucumber tree) + `progress` (dots), NO_COLOR/TTY-aware                          |
| `../globFiles.ts` | shared portable glob (see divergence #1)                                                  |

Plus the agreed **`engine.ts` refactor**:

- `compileRegistry()` — compile Cucumber expressions **once per run** (was
  recompiling per scenario: O(scenarios × steps) waste).
- `runScenario()` is now **non-throwing** — returns a `ScenarioResult` carrying
  per-step status + first `error` (with the synthetic `.feature` stack frame
  attached). Reporters render failures; the runner never uses throw for control
  flow.
- `vitest.ts` codegen updated to the new signature (compile once at module top,
  re-throw `result.error`) so the Vitest adapter stays green.

A root `step-forge.config.ts` mirrors `vitest.config.ts` (same exact feature
files + step/world modules) so `bun src/runtime/cli.ts` runs with zero flags.

**Verified:** parity with Vitest (`25 passed, 1 skipped, 0 failed`); ~2.2s vs
Vitest ~3.9s (the 2.2s is almost entirely the analyzer's per-call `ts.Program`
creation — non-analyzer features run in ~0.1s); `tsc --noEmit` clean; new files
lint-clean; filters, `@skip`/`@only`, and exit codes all work.

## Node/Bun divergences found & fixed

1. **`node:fs` `glob` ignores absolute-path patterns under Bun** (Node matches
   them). Silently made the analyzer return `[]` for every input. Fixed centrally
   in `src/globFiles.ts`: a literal absolute path short-circuits `glob()` and is
   returned directly if it exists; only relative patterns are globbed (against
   `cwd`). Wired into both `runner.ts` and `analyzer/index.ts` (which had its own
   copy of the bug).
2. **Concurrency vs Cucumber semantics** → see the active focus below.

## Concurrency model — DECIDED & RESOLVED

**Model: in-process async concurrency only.** No `node:worker_threads`, no
process forking. `runner.ts` uses a dependency-free `runPool(items, limit,
worker)` that returns results in input order; `--concurrency N` opts in, default
`1`.

**Why this is safe without isolation machinery:** the framework's opinionated
invariant — _module state is immutable and scenario-isolated_ — is exactly what
makes in-process parallelism race-free. All mutable scenario state lives in the
per-scenario world (already isolated); module state is write-once config / pure
lookups. Given that invariant, concurrent scenarios cannot corrupt each other, so
we don't need workers. The invariant and the concurrency-only choice reinforce
each other.

**The one violation we found & removed:** `features/steps/commonSteps.ts` had a
`beforeScenario` hook writing `lastScenarioName = scenario.name` into a module
`let`, and a step asserting it equalled its own scenario name. That's a hook
seeding mutable state a step reads back — a cross-scenario data race that only
held under serial execution. Removed the variable + assertion; the step now only
checks the write-once/monotonic flags (`globalStarted`, `featureStarted`,
`beforeScenarioRuns > 0`), which are concurrency-safe.

**Rejected: giving steps their own scenario identity.** We considered adding
`scenario` to the step context so the observability the old test wanted could be
race-free. Rejected — a step knowing which scenario it's in invites branching on
scenario name and other cross-scenario coupling, exactly the anti-patterns the
framework exists to prevent. Not worth it for a hook smoke-test.

**Hook-plumbing correctness moved to a runtime unit test:**
`src/runtime/hooks.test.ts` (`bun:test`) asserts `beforeScenario` receives the
right scenario identity, before/after ordering, and — run concurrently — that
each scenario's hook sees only its own identity (no cross-talk). Verified: the
feature suite now passes at `--concurrency 4` (was failing 24/1, now 25/1).

Runtime unit tests use **`bun:test`** directly (internal-only, never shipped, so
Node portability isn't required — unlike consumer-facing code). Run with
`bun test src/runtime` (or the `test:unit` npm script).

## Backlog (parked — work on later)

### Flip the default runner — DONE

- `npm test` now runs `bun test src/runtime` (unit) + `bun src/runtime/cli.ts`
  (features). Vitest fully removed: deleted `vitest.config.ts` and
  `src/runtime/vitest.ts`, dropped the `/vitest` package export + its tsdown
  entry, and removed the `vitest` (and unused `tsx`) dependencies. Docs updated
  (`CLAUDE.md`, `features/TESTING.md`). `docs/assets/known_gaps.md` is left as a
  historical decisions log and still references the old Vitest mechanism.

### Publishing wiring — DONE

- `step-forge` bin → `./dist/cli.js` in `package.json`.
- CLI added to the **same** tsdown build group as `step-forge` + `runtime` (not
  its own group) so all three share the single `globalRegistry` chunk. Verified:
  one `new StepRegistry()` in the whole dist; `cli.js`, `step-forge.js`, and
  `runtime.js` all import the same `hooks-*.js` chunk.
- `engines.bun >= 1.0.0` declared; the bin shebang is `#!/usr/bin/env bun`.
- `RunnerOptions` exported from the `/runtime` entry (ships in `runtime.d.ts`).
- End-to-end verified against a simulated consumer (steps registered through the
  published `@step-forge/step-forge` import, run via the built bin): passing
  suite → exit 0, undefined step → exit 1 with a `.feature` code frame.

### Phase 2 — parity & polish

- Worker-pool execution mode (ties into the concurrency work above).
- Watch mode (`node:fs.watch`/chokidar; re-run affected features).
- JUnit + JSON reporters for CI.
- `--bail`, retries.

### Phase 3 — DX

- Source-map-aware stack traces.
- `--only-failures`.
- Coverage integration.
