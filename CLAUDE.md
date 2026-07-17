# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This repo uses **Bun** for everything — package management (`bun install`, `bun.lock`) and running commands. Node is not required for development.

```bash
bun install             # Install dependencies (writes bun.lock)
bun run test            # Runtime unit tests + all feature tests, single run
bun run test:unit       # Runtime unit tests only  (bun test src)
bun run test:features   # Feature tests only        (bun src/runtime/cli.ts)
bun run test:ci         # Alias for `bun run test`
bun run build           # Full build: clean → tsc typecheck → tsdown (bundle + dts) → copy package.json
bun run lint            # ESLint
bun run format          # Prettier
```

Use `bun run test`, **not** `bun test` — the latter is Bun's own test runner and would only pick up `src/runtime/*.test.ts`, skipping the feature suite. To run a subset, pass feature globs or filters to the runner: `bun src/runtime/cli.ts features/basic.feature` (by file), `--name "part of the scenario name"` (by name), or `--tags "@foo and not @bar"` (by tag).

## Architecture

Step Forge is a TypeScript library for writing **type-safe Gherkin step definitions** using a builder pattern, with a **native Bun runtime** (`src/runtime/cli.ts`, the `step-forge` bin) that executes features directly — no Vitest, no Cucumber.js. It does use two standalone Cucumber _libraries_: `@cucumber/gherkin` (+ `@cucumber/messages`) to parse `.feature` files, and `@cucumber/cucumber-expressions` to match step text — but nothing from `@cucumber/cucumber` itself. See `RUNTIME.md` for the consumer-facing runner guide.

### Builder Chain

Each Gherkin phase (given/when/then) has a builder with two entry styles:

```
builder<State>().statement("plain string")                     → .dependencies?(deps) → .step(fn)
builder<State>().variables({name: parser}).statement(v => ...) → .dependencies?(deps) → .step(fn)
```

- **Variables**: A statement with variables must declare them first via `.variables({ amount: intParser, currency: stringParser })` — a name → parser map that is the single source of truth for each variable's name, placeholder, and TypeScript type. There is no positional style and no `.parsers()`; every variable's parser is explicit (use `stringParser` for strings).
- **Statement**: A plain string (no variables), or — after `.variables()` — a function receiving one opaque token per declared variable: `` v => `a user named ${v.userName}` ``. At registration the statement is called once with recording tokens (`renderNamedExpression` in `src/variables.ts`): each token's `toString()` renders its parser's placeholder and records interpolation order, which is how positional captures map back to names at run time. Every declared variable must be interpolated exactly once or registration throws. Tokens are branded (`Variable<T>`) so hovering `v.amount` shows `Variable<number>` and any non-interpolation use is a type error.
- **Parsers**: A `Parser<T>` is a cucumber-expression _parameter type_: `{ name, regexp, parse }`. `name` drives the placeholder (`{name}`), `regexp` is how the value is recognised in step text, and `parse` transforms the match into `T`. The engine registers each parser into the expression's `ParameterTypeRegistry`, so matching and coercion happen in one pass (`parse` runs during matching, not after). This lets a parser introduce a novel placeholder like `{color}` that genuinely constrains matching. Built-in-named parsers (`{int}`/`{float}`/`{string}`) defer to cucumber's own built-in types.
- **Dependencies**: Declare which keys from other phases' state this step needs. Keys are marked `"required"` or `"optional"`. Required deps are validated at runtime; optional ones may be `undefined`.
- **Step function**: Receives `{ variables, given, when, then }` — `variables` is a name-keyed object typed from the parsers; only the phases allowed by the builder type are accessible (given steps can't access when/then state).
- **`.step(fn)` registers.** Calling `.step()` is the terminal action: it adds the step to the runtime registry (`globalRegistry`) and returns the step metadata (`{ statement, expression, dependencies, stepType, stepFunction }`). `expression` is literal-typed: the exact string for a string statement, a `${string}`-holed template type for a token statement. There is no `.register()` — calling `.step()` on a partial chain both builds and registers, so building a step purely to inspect its `.expression` also registers it.

### Phase Restrictions

- `givenBuilder` — dependencies on `given` only, returns `Partial<GivenState>`
- `whenBuilder` — dependencies on `given` and `when`, returns `Partial<WhenState>`
- `thenBuilder` — dependencies on all three phases, returns `Partial<ThenState> | void`

### Key Source Files

- `src/common.ts` — `addStep()`: renders the step `expression` from the statement + variables map (via `renderNamedExpression`), wires the `execute(world, rawArgs)` body (dependency validation/narrowing, positional-capture → named-variables mapping, state merge), and registers into `globalRegistry` on `.step()`.
- `src/variables.ts` — the named-variable machinery: `VariableMap`, `Variable<T>` (branded token type), `VariableTokens`, `VariablesOf`, and `renderNamedExpression()` (token `toString()` dance that renders placeholders and records interpolation order; validates each variable is interpolated exactly once).
- `src/given.ts`, `src/when.ts`, `src/then.ts` — Builder implementations with phase-specific type constraints
- `src/parsers.ts` — `Parser<T>` (`{ name, regexp, parse }`, a cucumber-expression parameter type) plus builtins: `stringParser` (`{string}`, strips quotes), `intParser` (`{int}`), `numberParser` (`{float}`), `booleanParser` (custom `{boolean}`, matches `true`/`false`)
- `src/world.ts` — `BasicWorld<Given, When, Then>` with `MergeableWorldState` (lodash deep merge, arrays concatenate)
- `src/builderTypeUtils.ts` — TypeScript utility types driving the builder's type safety
- `src/utils.ts` — `requireFrom{Given,When,Then}()` for runtime required-dependency validation
- `src/sourceLocation.ts` — capture/trim source locations. `captureDefinitionSite()` (used by `.step()`) records where a step is defined; `userFrames()` trims an error stack to user code (drops library, engine, and `node_modules` frames). Used by `common.ts` (capture) and `reporters.ts` (render).

#### Runtime (`src/runtime/`)

- `registry.ts` — `StepRegistry` and the `globalRegistry` singleton. Steps register here; the engine reads from here.
- `engine.ts` — `compileRegistry(registry)` compiles the step expressions **once** per run; `runScenario(scenario, compiled, makeWorld)` matches each Gherkin step via a `CucumberExpression` (strict — undefined and ambiguous both throw during matching), runs it against a fresh world per scenario, skips remaining steps after the first failure, and returns a `ScenarioResult`. It **never throws for a test failure** — the first error is on the result, and each `StepResult` carries the matched step's definition `source` (file:line) for the reporter to show. Location rendering is structural (from `step.line` + `source`), not a synthetic stack frame.
- `cli.ts` — the `step-forge` CLI (`#!/usr/bin/env bun`): arg parsing, exit codes (`0` pass / `1` fail).
- `config.ts` — loads `step-forge.config.ts` and merges CLI overrides (`RunnerOptions`).
- `runner.ts` — discovers + parses features, imports step modules (self-register), compiles once, filters, and runs scenarios through a concurrency-capped pool (serial by default).
- `filter.ts` — Cucumber tag-expression evaluator + name / `@only` / `@skip` selection.
- `reporters.ts` — `pretty` (default) and `progress` reporters. Both take a `verbose` flag: default output is a dots heartbeat + failures-only in Cucumber style (`feature:` line, `defined:` step location, error trimmed to user frames); `--verbose` makes `pretty` print the full tree. Locations come from `../sourceLocation`.
- `index.ts` — the `@step-forge/step-forge/runtime` barrel (runner-agnostic core for building other adapters).

### Testing

Feature tests run under **Bun** via the native runner (`bun src/runtime/cli.ts`, aka `npm run test:features`), configured by `step-forge.config.ts`. The runner parses each `.feature`, imports the step-definition modules so they self-register into `globalRegistry`, compiles the step expressions once, and executes scenarios **serially by default** (raise `--concurrency` to parallelize — safe because scenario state lives only in the per-scenario world). Runtime internals also have `bun:test` unit tests (`src/**/*.test.ts`, run via `bun test src` / `bun run test:unit`); `bun run test` runs both.

Type-safety tests use `@ts-expect-error` annotations validated at `tsc` compile time (`npm run build` runs `tsc --noEmit`), not at runtime.

`step-forge.config.ts` runs three feature files through the native runner: `features/basic.feature` (steps in `features/steps/commonSteps.ts`), `features/tags.feature`, and `features/analyzer/analyzer.feature`, the analyzer's own self-tests (steps in `features/steps/analyzerSteps.ts`, which drive the `analyze()` API and flow diagnostics through world state like any other scenario). `features` is a list of **exact** files so the analyzer's `fixtures/*.feature` — which are _inputs_ to `analyze()`, not tests — are never discovered as scenarios.

The project no longer depends on the `@cucumber/cucumber` runtime at all; every path runs natively under the Bun runner. Remaining un-wired files are demos only:

- `features/exported.feature` / `placeholders.feature` — builder-pattern demos (IDE-integration examples); not currently executed.

In-repo the runner and the step files both import from `src/` directly (Bun runs the TypeScript sources), so they naturally resolve the **same** `globalRegistry`; there is no build indirection to configure. In the published package the CLI shares one bundled `globalRegistry` chunk with the main entry (see Build Output).

### Analyzer

The analyzer (`src/analyzer/`) statically checks `.feature` files against step definitions without running them. It parses features with `@cucumber/gherkin` (`gherkinParser.ts`), extracts step metadata from TypeScript source via the AST (`stepExtractor.ts`, keyed off the terminal `.step(...)` call), matches them (`stepMatcher.ts`), and runs rules (`rules/`). Exposed as the `analyze()` API (`@step-forge/step-forge/analyzer`) and the `step-forge-analyze` CLI.

Expression extraction reconstructs each hole's **exact** placeholder from the `.variables()` map: built-in parsers resolve by export name on the parse-only fast path, same-file custom parsers by reading their declaration's `name` property (and `regexp`, emitted as `StepDefinitionMeta.parameters`), and imported custom parsers via the type checker, which follows the symbol to its value declaration and reads `name`/`regexp` from the AST there (this triggers the one-time type-checked retry). An unresolvable hole keeps the variable's own name as its placeholder, which the matcher treats as match-anything.

Matching (`stepMatcher.ts`) compiles each expression with `@cucumber/cucumber-expressions` exactly like the runtime engine (`compileRegistry`): a per-definition `ParameterTypeRegistry` seeded with cucumber's builtins, the library's builtin parsers (imported from `src/parsers.ts` — one source of truth), and the extracted `parameters` patterns, with a match-anything parameter type only for a placeholder the extractor couldn't resolve. Strictness, case sensitivity, optional text `(s)`, and alternation `a/b` therefore agree with the runtime by construction — `I deposit ten` against `I deposit {int}` is an undefined-step diagnostic, not a match. Compilation is memoized per definitions array, so `analyze()` compiles once per run, not per scenario. Tests: `src/analyzer/stepExtractor.test.ts` + `stepMatcher.test.ts` (units, against `features/analyzer/fixtures/steps.ts`), and the `valid-parsers.feature` / `mismatched-parsers.feature` scenarios in `analyzer.feature` (end-to-end).

The **step catalog** (`src/analyzer/catalog.ts`) exposes the same static extraction as queryable data: `buildCatalog({ stepFiles })` returns a versioned envelope `{ version: 1, steps: CatalogEntry[] }` (each entry is `StepDefinitionMeta` plus a stable `id` of `sourceFile:line`, sorted for determinism), and the pure `filterCatalog(steps, query)` filters by `stepType`, expression `text`, `sourceFile`, consumed state (`consumes: { key, phase?, requirement? }` against the `.dependencies()` declarations), and produced state (`produces`, matched against the best-effort inferred return keys). Both are exported from `@step-forge/step-forge/analyzer` and the root `analyzer` namespace. The CLI grew a `step-forge-analyze catalog` subcommand (`--json` for the machine envelope; `--type`/`--text`/`--consumes given.user:required`/`--produces`/`--source` filters). Both CLI modes (diagnostics and catalog) resolve their globs with runner precedence via `loadConfigFile`/`resolveConfig` from `src/runtime/config.ts`: `--steps`/`--features` flags win, otherwise `step-forge.config.ts` in the cwd, otherwise the runner defaults — so a configured repo can run `step-forge-analyze` with no flags. `analyze()` excludes `@skip`-tagged scenarios (mirroring the runner — they never execute, so the deliberately-broken `@skip` scenario in `features/tags.feature` doesn't fail analysis; fixture: `skip-tag.feature`). Tests: `src/analyzer/catalog.test.ts`, `cli.test.ts` (subprocess, asserts the JSON contract), and the catalog scenarios in `analyzer.feature`. The JSON envelope is the documented contract for external consumers (VS Code plugin, agent tooling) — bump `version` only on breaking shape changes (see README "Step Catalog").

### Build Output

`tsdown` (configured in `tsdown.config.ts`, powered by rolldown) produces JS bundles and bundled type declarations in one pass. Two build groups:

1. **`step-forge` (main) + `runtime` + `cli`** — ESM + CJS. Built together **on purpose**: the step registry is emitted as a single shared chunk so the builders (main entry), `runScenario` (runtime entry), and the `step-forge` CLI (`cli` entry) all share the **same** `globalRegistry` instance. Splitting the CLI out would bundle a second registry and silently break registration for steps a consumer registers via `@step-forge/step-forge`.
2. **`analyzer` + `analyzer-cli`** — ESM only.

Dependencies and `node:` builtins are externalized automatically. The `build/` directory is the publishable package.

## Exports

- `@step-forge/step-forge` — `givenBuilder`, `whenBuilder`, `thenBuilder`, `BasicWorld`, the parsers (`stringParser`, `intParser`, `numberParser`, `booleanParser`), `createBuilders` (pre-bound builders: `Given("...")` for strings, `Given.variables({...}).statement(v => ...)` for variables), the hooks (`beforeScenario`/`afterScenario`/`beforeFeature`/`afterFeature`/`beforeAll`/`afterAll`), and types (`Parser`, `Variable`, `VariableMap`, `VariableTokens`, `VariablesOf`, `NoVariables`, `StateFromDependencies`, `RunnerOptions` for typing `step-forge.config.ts`, …). From `src/index.ts`.
- `@step-forge/step-forge/runtime` — `runScenario`, `compileRegistry`, `StepRegistry`, `globalRegistry`, `UndefinedStepError`, `AmbiguousStepError`, the `RunnerOptions` type, and their types.
- `@step-forge/step-forge/analyzer` — `analyze()` and related APIs.
- Bins: `step-forge` (the feature runner, `src/runtime/cli.ts`) and `step-forge-analyze` (the analyzer CLI). Both run under **Bun**.

The runner requires **Bun**; `typescript` is an optional peer dependency (for the analyzer's AST extraction).
