# Step Forge Runtime

The Step Forge runtime executes your `.feature` files against your step
definitions. It is a native TypeScript runner built for speed and Cucumber-like
semantics — it does **not** run the Cucumber.js runtime, and it does not require
a bundler or a separate test framework.

If you only want to run features, this document is all you need. For how to
_write_ steps, the world, parsers, and dependencies, see the main
[README](./README.md).

---

## Requirements

The runner executes under **[Bun](https://bun.sh)** so your TypeScript step
files run directly, with no transpile/build step and no loader configuration.
Bun is the one hard requirement:

```bash
curl -fsSL https://bun.sh/install | bash   # or: brew install oven-sh/bun/bun
```

Everything the runner touches beyond that uses standard `node:` APIs, so your
step code stays ordinary TypeScript.

## Install

```bash
npm install --save-dev @step-forge/step-forge
```

## Quickstart

1. **Write step definitions.** A step self-registers the moment you call
   `.step(...)` — no separate registration call. Put them in files matched by
   your `steps` glob (default `**/*.steps.ts`).

   ```ts
   // features/steps/user.steps.ts
   import { givenBuilder, thenBuilder } from "@step-forge/step-forge";

   givenBuilder<{ user: string }>()
     .statement((name: string) => `a user named ${name}`)
     .step(({ variables: [name] }) => ({ user: name }));

   thenBuilder<{ user: string }, {}, {}>()
     .statement((name: string) => `the user is ${name}`)
     .dependencies({ given: { user: "required" } })
     .step(({ variables: [name], given: { user } }) => {
       if (user !== name) throw new Error(`expected ${name}, got ${user}`);
     });
   ```

2. **Provide a world factory** (optional). One fresh world is created per
   scenario, so state never leaks between scenarios. Omit this to get a default
   `BasicWorld`.

   ```ts
   // features/support/world.ts
   import { BasicWorld } from "@step-forge/step-forge";
   export default () => new BasicWorld();
   ```

3. **Add a config file** (optional but recommended).

   ```ts
   // step-forge.config.ts
   import type { RunnerOptions } from "@step-forge/step-forge";

   const config: RunnerOptions = {
     features: "features/**/*.feature",
     steps: "features/**/*.steps.ts",
     world: "features/support/world.ts",
   };
   export default config;
   ```

4. **Run.**

   ```bash
   step-forge
   ```

   A typical `package.json` wires it as the test script:

   ```json
   { "scripts": { "test": "step-forge" } }
   ```

## Configuration

Config is resolved from three sources, later ones overriding earlier ones:
**defaults → `step-forge.config.ts` → CLI flags**. Every field is optional.

| Field         | Type                     | Default         | Meaning                                                           |
| ------------- | ------------------------ | --------------- | ----------------------------------------------------------------- |
| `features`    | `string \| string[]`     | `**/*.feature`  | Feature-file glob(s), relative to the config directory.           |
| `steps`       | `string \| string[]`     | `**/*.steps.ts` | Step-module glob(s). Importing them is what registers your steps. |
| `world`       | `string`                 | `BasicWorld`    | Module that default-exports a world factory `() => world`.        |
| `concurrency` | `number`                 | `1` (serial)    | Max scenarios in flight at once. See [Concurrency](#concurrency). |
| `reporter`    | `"pretty" \| "progress"` | `pretty`        | Output style. See [Reporters & output](#reporters--output).       |
| `verbose`     | `boolean`                | `false`         | Report every scenario, not just failures.                         |
| `name`        | `string`                 | —               | Only scenarios whose name matches (substring, or `/regex/flags`). |
| `tags`        | `string`                 | —               | Cucumber tag expression, e.g. `@smoke and not @wip`.              |

The config file is loaded by Bun, so it may be TypeScript and import the
`RunnerOptions` type for editor help.

## CLI

```
step-forge [options] [feature globs...]
```

Positional arguments are feature globs and **override** the configured
`features`, so you can run a subset ad hoc.

| Flag                | Short | Description                                              |
| ------------------- | ----- | -------------------------------------------------------- |
| `--tags <expr>`     | `-t`  | Tag expression, e.g. `"@smoke and not @wip"`.            |
| `--name <pattern>`  | `-n`  | Only scenarios whose name matches (substring/`/regex/`). |
| `--steps <glob>`    | `-s`  | Step-module glob (repeatable).                           |
| `--world <module>`  | `-w`  | World factory module.                                    |
| `--concurrency <n>` | `-c`  | Max scenarios in flight (default `1`).                   |
| `--reporter <name>` | `-r`  | `pretty` (default) or `progress`.                        |
| `--verbose`         | `-v`  | Report every scenario, not just failures.                |
| `--interactive`     | `-i`  | Interactive watch mode (see below). Requires a TTY.      |
| `--config <path>`   |       | Directory to resolve the config file and globs from.     |
| `--help`            | `-h`  | Show usage.                                              |

Examples:

```bash
step-forge features/checkout.feature          # one file
step-forge --tags "@smoke and not @wip"       # by tag
step-forge --name "logs in"                    # by scenario name
step-forge --concurrency 8 --reporter progress # parallel, compact output
```

The process exits `0` when every scenario passes and `1` when any scenario
fails, so it drops straight into CI.

## Interactive mode

`step-forge -i` takes over the terminal with a full-screen dashboard and watches
your feature/step directories. It is laid out top-to-bottom:

1. **Prompt** — a Claude-Code-style typeahead. Start typing to filter every
   **tag**, **feature**, and **scenario** in your suite. A **scenario outline**
   appears as a single entry that runs all of its example rows. A special
   **`@all`** entry at the top runs every configured scenario at once.
2. **Selection** — the ranked matches; `↑`/`↓` move the highlight.
3. **Results** — the current run, ordered so the summary is right under the
   controls: **stats** (live pass/fail/skip tallies + duration) on top, the
   **progress dots** below them, and any **failures** at the bottom.

```bash
step-forge -i                 # browse and pick from everything
step-forge -i -t "@smoke"     # open with the query pre-filled
```

The prompt is always live, with one committed selection (the _armed_
population):

- **Enter** arms the highlighted choice, runs it immediately, and re-runs it on
  every subsequent file change. Pressing Enter again forces a re-run.
- **Editing the query** suspends auto-runs until you press Enter again — so you
  can retarget without a half-typed selection firing.
- **↑ / ↓** move the selection highlight. The **mouse wheel** (or **PgUp /
  PgDn**) scrolls the failures pane when a run has more failures than fit on
  screen — the prompt, selection, and stats stay pinned. (While the dashboard is
  up the wheel drives the results pane, so hold **Shift** for native terminal
  text selection.)
- **Esc** disarms and returns to browsing.
- **Ctrl-C** quits and restores the terminal.

A selection that resolves to a **single scenario** is first passed through the
analyzer, so undefined/ambiguous steps and dependency problems surface (above the
dots) before it runs.

Each run executes in a fresh `step-forge` child process, so edited step
definitions are always picked up — there is no stale module cache between runs.
The child streams its results back as an event stream, which the dashboard
renders in place. Recursive watching works on macOS, Windows, and modern Linux
(Node ≥ 20 / Bun).

## Hooks

Hooks are side-effect callbacks for setup/teardown (start a server, reset a
mock). They **never seed scenario state** — that flows exclusively through
`given`/`when`/`then` so the typed dependency graph stays the single source of
truth. Import them from the main entry:

```ts
import {
  beforeAll,
  afterAll,
  beforeFeature,
  afterFeature,
  beforeScenario,
  afterScenario,
} from "@step-forge/step-forge";

beforeScenario(({ world, scenario }) => {
  /* fresh world available; reset external state here */
});
```

| Hook                             | Runs                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `beforeAll`/`afterAll`           | Once around the entire run — `beforeAll` before concurrency starts, `afterAll` after every scenario is done. |
| `beforeFeature`/`afterFeature`   | Around each feature file.                                                                                    |
| `beforeScenario`/`afterScenario` | Around each scenario (gets its world).                                                                       |

Multiple `beforeAll` (and multiple `afterAll`) hooks run **in parallel** with no
ordering between them — if one setup step must precede another, sequence both
inside a single hook. Feature and scenario `after*` hooks instead run in reverse
registration order so teardown unwinds setup, and `afterScenario` runs even when
a step failed.

## Filtering

- **Tags** — `--tags` / `tags` accepts a Cucumber tag expression with `and`,
  `or`, `not`, parentheses, and `@tag` atoms:
  `@smoke and (@fast or not @flaky)`.
- **Name** — `--name` / `name` is a substring by default, or a regex if written
  as `/pattern/flags`.
- **`@skip`** — a scenario tagged `@skip` is never executed and is reported as
  skipped (not dropped silently).
- **`@only`** — if any selected scenario is tagged `@only`, the run is focused to
  just those. `@skip` wins over `@only`.

## Concurrency

Scenarios run **serially by default** (`concurrency: 1`), matching Cucumber.
Raise `--concurrency` (or the `concurrency` config field) to run scenarios
concurrently in a single process — ideal for I/O-bound suites.

This is safe because of one opinionated invariant Step Forge holds:

> **Module state is immutable and scenario-isolated.** All mutable scenario
> state lives in the per-scenario world (already isolated); anything at module
> scope is write-once configuration or pure lookups.

Because mutable state can't be shared across scenarios, concurrent scenarios
cannot corrupt one another — no worker threads or process isolation required.
The corollary is a rule to follow in your own code: **do not have a hook or step
write to a mutable module-level variable that another step reads.** That is a
cross-scenario data race and the only way to break parallel runs. Keep
per-scenario state in the world and you can turn concurrency up freely.

## Reporters & output

By default the runner is quiet: it prints a dot per scenario as a heartbeat
(`.` pass, `F` fail, `-` skip), then **only the failing scenarios** in detail,
then a summary. Pass `--verbose` (`-v`) to report every scenario instead.

Each failure is shown Cucumber-style so it's easy to locate:

```
✗ a user can log in
    features/auth.feature:12

  ✓ Given a registered user
  ✗ Then they reach the dashboard
      feature: features/auth.feature:15
      defined: features/steps/auth.steps.ts:40
      AssertionError: expected "/login" to equal "/dashboard"
          at features/steps/auth.steps.ts:42:18
```

- **`feature:`** — the `.feature` file and line of the failing step.
- **`defined:`** — where that step is defined (its `.step(...)` call site).
- The stack is trimmed to your own code (library, engine, and `node_modules`
  frames removed) and source-mapped by Bun to the original TypeScript, so the
  top frame is the line in your step that actually threw.

Two styles are available via `--reporter`:

- **`pretty`** (default) — honours `--verbose`: failures-only by default, or the
  full feature → scenario → step tree (each step annotated with its definition
  location) under `--verbose`.
- **`progress`** — always compact (dots + failures + summary); ignores
  `--verbose`.

Colour is emitted only to a TTY and is disabled when `NO_COLOR` is set.
