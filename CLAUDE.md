# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                # Runtime unit tests (bun test) + all feature tests (Bun runner), single run
npm run test:unit       # Runtime unit tests only  (bun test src/runtime)
npm run test:features   # Feature tests only        (bun src/runtime/cli.ts)
npm run test:ci         # Alias for `npm test`
npm run build           # Full build: clean → tsc typecheck → tsdown (bundle + dts) → copy package.json
npm run lint            # ESLint
npm run format          # Prettier
```

The runner requires **Bun** (it runs the TypeScript step files natively). To run a subset, pass feature globs or filters to the runner: `bun src/runtime/cli.ts features/basic.feature` (by file), `--name "part of the scenario name"` (by name), or `--tags "@foo and not @bar"` (by tag).

## Architecture

Step Forge is a TypeScript library for writing **type-safe Gherkin step definitions** using a builder pattern, with a **native Bun runtime** (`src/runtime/cli.ts`, the `step-forge` bin) that executes features directly — no Vitest, no Cucumber.js. It does use two standalone Cucumber *libraries*: `@cucumber/gherkin` (+ `@cucumber/messages`) to parse `.feature` files, and `@cucumber/cucumber-expressions` to match step text — but nothing from `@cucumber/cucumber` itself. See `RUNTIME.md` for the consumer-facing runner guide.

### Builder Chain

Each Gherkin phase (given/when/then) has a builder that follows this chain:

```
builder<State>().statement(str | fn) → .parsers?(parsers) → .dependencies?(deps) → .step(fn)
```

- **Statement**: A string or function. Functions define variables via parameters: `(name: string) => \`a user named ${name}\`` — each parameter becomes a placeholder in the step expression (`{string}` by default, or the placeholder of the matching parser).
- **Parsers**: Optional, one per variable. A `Parser<T>` is a cucumber-expression *parameter type*: `{ name, regexp, parse }`. `name` drives the placeholder (`{name}`), `regexp` is how the value is recognised in step text, and `parse` transforms the match into `T`. The engine registers each parser into the expression's `ParameterTypeRegistry`, so matching and coercion happen in one pass (`parse` runs during matching, not after). This lets a parser introduce a novel placeholder like `{color}` that genuinely constrains matching. Built-in-named parsers (`{int}`/`{float}`/`{string}`) defer to cucumber's own built-in types. Default is `stringParser` for every variable.
- **Dependencies**: Declare which keys from other phases' state this step needs. Keys are marked `"required"` or `"optional"`. Required deps are validated at runtime; optional ones may be `undefined`.
- **Step function**: Receives `{ variables, given, when, then }` — only the phases allowed by the builder type are accessible (given steps can't access when/then state).
- **`.step(fn)` registers.** Calling `.step()` is the terminal action: it adds the step to the runtime registry (`globalRegistry`) and returns the step metadata (`{ statement, expression, dependencies, stepType, stepFunction }`). There is no `.register()` — calling `.step()` on a partial chain both builds and registers, so building a step purely to inspect its `.expression` also registers it.

### Phase Restrictions

- `givenBuilder` — dependencies on `given` only, returns `Partial<GivenState>`
- `whenBuilder` — dependencies on `given` and `when`, returns `Partial<WhenState>`
- `thenBuilder` — dependencies on all three phases, returns `Partial<ThenState> | void`

### Key Source Files

- `src/common.ts` — `addStep()`: builds the step `expression` from the statement + parsers, wires the `execute(world, rawArgs)` body (parser coercion, dependency validation/narrowing, state merge), and registers into `globalRegistry` on `.step()`.
- `src/given.ts`, `src/when.ts`, `src/then.ts` — Builder implementations with phase-specific type constraints
- `src/parsers.ts` — `Parser<T>` (`{ name, regexp, parse }`, a cucumber-expression parameter type) plus builtins: `stringParser` (`{string}`, strips quotes), `intParser` (`{int}`), `numberParser` (`{float}`), `booleanParser` (custom `{boolean}`, matches `true`/`false`)
- `src/world.ts` — `BasicWorld<Given, When, Then>` with `MergeableWorldState` (lodash deep merge, arrays concatenate)
- `src/builderTypeUtils.ts` — TypeScript utility types driving the builder's type safety
- `src/utils.ts` — `requireFrom{Given,When,Then}()` for runtime required-dependency validation

#### Runtime (`src/runtime/`)

- `registry.ts` — `StepRegistry` and the `globalRegistry` singleton. Steps register here; the engine reads from here.
- `engine.ts` — `compileRegistry(registry)` compiles the step expressions **once** per run; `runScenario(scenario, compiled, makeWorld)` matches each Gherkin step via a `CucumberExpression` (strict — undefined and ambiguous both throw during matching), runs it against a fresh world per scenario, skips remaining steps after the first failure, and returns a `ScenarioResult`. It **never throws for a test failure** — the first error is attached to the result with a synthetic `.feature` stack frame for reporters to render.
- `cli.ts` — the `step-forge` CLI (`#!/usr/bin/env bun`): arg parsing, exit codes (`0` pass / `1` fail).
- `config.ts` — loads `step-forge.config.ts` and merges CLI overrides (`RunnerOptions`).
- `runner.ts` — discovers + parses features, imports step modules (self-register), compiles once, filters, and runs scenarios through a concurrency-capped pool (serial by default).
- `filter.ts` — Cucumber tag-expression evaluator + name / `@only` / `@skip` selection.
- `reporters.ts` — `pretty` (feature tree) and `progress` (dots) reporters.
- `index.ts` — the `@step-forge/step-forge/runtime` barrel (runner-agnostic core for building other adapters).

### Testing

Feature tests run under **Bun** via the native runner (`bun src/runtime/cli.ts`, aka `npm run test:features`), configured by `step-forge.config.ts`. The runner parses each `.feature`, imports the step-definition modules so they self-register into `globalRegistry`, compiles the step expressions once, and executes scenarios **serially by default** (raise `--concurrency` to parallelize — safe because scenario state lives only in the per-scenario world). Runtime internals also have `bun:test` unit tests (`src/runtime/*.test.ts`, run via `bun test src/runtime` / `npm run test:unit`); `npm test` runs both.

Type-safety tests use `@ts-expect-error` annotations validated at `tsc` compile time (`npm run build` runs `tsc --noEmit`), not at runtime.

`step-forge.config.ts` runs three feature files through the native runner: `features/basic.feature` (steps in `features/steps/commonSteps.ts`), `features/tags.feature`, and `features/analyzer/analyzer.feature`, the analyzer's own self-tests (steps in `features/steps/analyzerSteps.ts`, which drive the `analyze()` API and flow diagnostics through world state like any other scenario). `features` is a list of **exact** files so the analyzer's `fixtures/*.feature` — which are *inputs* to `analyze()`, not tests — are never discovered as scenarios.

The project no longer depends on the `@cucumber/cucumber` runtime at all; every path runs natively under the Bun runner. Remaining un-wired files are demos only:

- `features/exported.feature` / `placeholders.feature` — builder-pattern demos (IDE-integration examples); not currently executed.

In-repo the runner and the step files both import from `src/` directly (Bun runs the TypeScript sources), so they naturally resolve the **same** `globalRegistry`; there is no build indirection to configure. In the published package the CLI shares one bundled `globalRegistry` chunk with the main entry (see Build Output).

### Analyzer

The analyzer (`src/analyzer/`) statically checks `.feature` files against step definitions without running them. It parses features with `@cucumber/gherkin` (`gherkinParser.ts`), extracts step metadata from TypeScript source via the AST (`stepExtractor.ts`, keyed off the terminal `.step(...)` call), matches them (`stepMatcher.ts`), and runs rules (`rules/`). Exposed as the `analyze()` API (`@step-forge/step-forge/analyzer`) and the `step-forge-analyze` CLI.

### Build Output

`tsdown` (configured in `tsdown.config.ts`, powered by rolldown) produces JS bundles and bundled type declarations in one pass. Two build groups:

1. **`step-forge` (main) + `runtime` + `cli`** — ESM + CJS. Built together **on purpose**: the step registry is emitted as a single shared chunk so the builders (main entry), `runScenario` (runtime entry), and the `step-forge` CLI (`cli` entry) all share the **same** `globalRegistry` instance. Splitting the CLI out would bundle a second registry and silently break registration for steps a consumer registers via `@step-forge/step-forge`.
2. **`analyzer` + `analyzer-cli`** — ESM only.

Dependencies and `node:` builtins are externalized automatically. The `build/` directory is the publishable package.

## Exports

- `@step-forge/step-forge` — `givenBuilder`, `whenBuilder`, `thenBuilder`, `BasicWorld`, the parsers (`stringParser`, `intParser`, `numberParser`, `booleanParser`), `createBuilders`, the hooks (`beforeScenario`/`afterScenario`/`beforeFeature`/`afterFeature`/`beforeAll`/`afterAll`), and types (`Parser`, `StateFromDependencies`, …). From `src/index.ts`.
- `@step-forge/step-forge/runtime` — `runScenario`, `compileRegistry`, `StepRegistry`, `globalRegistry`, `UndefinedStepError`, `AmbiguousStepError`, the `RunnerOptions` type, and their types.
- `@step-forge/step-forge/analyzer` — `analyze()` and related APIs.
- Bins: `step-forge` (the feature runner, `src/runtime/cli.ts`) and `step-forge-analyze` (the analyzer CLI). Both run under **Bun**.

The runner requires **Bun**; `typescript` is an optional peer dependency (for the analyzer's AST extraction).
