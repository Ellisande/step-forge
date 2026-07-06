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
   import type { RunnerOptions } from "@step-forge/step-forge/runtime";

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

| Field         | Type                      | Default            | Meaning                                                                 |
| ------------- | ------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `features`    | `string \| string[]`      | `**/*.feature`     | Feature-file glob(s), relative to the config directory.                 |
| `steps`       | `string \| string[]`      | `**/*.steps.ts`    | Step-module glob(s). Importing them is what registers your steps.       |
| `world`       | `string`                  | `BasicWorld`       | Module that default-exports a world factory `() => world`.              |
| `concurrency` | `number`                  | `1` (serial)       | Max scenarios in flight at once. See [Concurrency](#concurrency).       |
| `reporter`    | `"pretty" \| "progress"`  | `pretty`           | Output style. See [Reporters](#reporters).                              |
| `name`        | `string`                  | —                  | Only scenarios whose name matches (substring, or `/regex/flags`).       |
| `tags`        | `string`                  | —                  | Cucumber tag expression, e.g. `@smoke and not @wip`.                    |

The config file is loaded by Bun, so it may be TypeScript and import the
`RunnerOptions` type for editor help.

## CLI

```
step-forge [options] [feature globs...]
```

Positional arguments are feature globs and **override** the configured
`features`, so you can run a subset ad hoc.

| Flag                    | Short | Description                                             |
| ----------------------- | ----- | ------------------------------------------------------- |
| `--tags <expr>`         | `-t`  | Tag expression, e.g. `"@smoke and not @wip"`.           |
| `--name <pattern>`      | `-n`  | Only scenarios whose name matches (substring/`/regex/`).|
| `--steps <glob>`        | `-s`  | Step-module glob (repeatable).                          |
| `--world <module>`      | `-w`  | World factory module.                                   |
| `--concurrency <n>`     | `-c`  | Max scenarios in flight (default `1`).                  |
| `--reporter <name>`     | `-r`  | `pretty` (default) or `progress`.                       |
| `--config <path>`       |       | Directory to resolve the config file and globs from.    |
| `--help`                | `-h`  | Show usage.                                             |

Examples:

```bash
step-forge features/checkout.feature          # one file
step-forge --tags "@smoke and not @wip"       # by tag
step-forge --name "logs in"                    # by scenario name
step-forge --concurrency 8 --reporter progress # parallel, compact output
```

The process exits `0` when every scenario passes and `1` when any scenario
fails, so it drops straight into CI.

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

| Hook                  | Runs                                             |
| --------------------- | ------------------------------------------------ |
| `beforeAll`/`afterAll` | Once around the entire run.                     |
| `beforeFeature`/`afterFeature` | Around each feature file.               |
| `beforeScenario`/`afterScenario` | Around each scenario (gets its world).|

`after*` hooks run in reverse registration order so teardown unwinds setup, and
`afterScenario` runs even when a step failed.

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

## Reporters

- **`pretty`** (default) — a Cucumber-style tree grouped by feature, each
  scenario listing its steps with pass/fail/skip marks, then a summary. Failures
  include a stack frame pointing at the failing line in the `.feature` file.
- **`progress`** — one character per scenario as it finishes (`.` pass, `F`
  fail, `-` skip), then failures in detail and the summary. Best for large
  suites.

Colour is emitted only to a TTY and is disabled when `NO_COLOR` is set.
