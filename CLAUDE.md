# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                # Run all feature tests (Vitest, single run)
npm run test:watch      # Vitest watch mode
npm run test:debug      # Single run with the verbose reporter (per-scenario output)
npm run test:ci         # Single run (CI)
npm run build           # Full build: clean → tsc typecheck → tsdown (bundle + dts) → copy package.json
npm run lint            # ESLint
npm run format          # Prettier
```

To run a subset, use Vitest's normal filtering: `npx vitest run features/basic.feature` (by file) or `npx vitest run -t "part of the scenario name"` (by name).

## Architecture

Step Forge is a TypeScript library for writing **type-safe Gherkin step definitions** using a builder pattern, with a **native runtime** that executes features under Vitest. It does **not** depend on the Cucumber.js runtime. It does use two standalone Cucumber *libraries*: `@cucumber/gherkin` (+ `@cucumber/messages`) to parse `.feature` files, and `@cucumber/cucumber-expressions` to match step text — but nothing from `@cucumber/cucumber` itself.

### Builder Chain

Each Gherkin phase (given/when/then) has a builder that follows this chain:

```
builder<State>().statement(str | fn) → .parsers?(parsers) → .dependencies?(deps) → .step(fn)
```

- **Statement**: A string or function. Functions define variables via parameters: `(name: string) => \`a user named ${name}\`` — each parameter becomes a placeholder in the step expression (`{string}` by default, or the placeholder of the matching parser).
- **Parsers**: Optional, one per variable. A `Parser<T>` declares the expression placeholder (`gherkin`, e.g. `{int}`) that drives matching, and a `parse` that coerces the **raw matched text** into `T`. Parsers own coercion end to end — e.g. `stringParser` strips the surrounding quotes, `intParser` parses the bare digits. Default is `stringParser` for every variable.
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
- `src/parsers.ts` — `Parser<T>` (`{ gherkin, parse }`) plus builtins: `stringParser` (`{string}`, strips quotes), `intParser` (`{int}`), `numberParser` (`{float}`), `booleanParser` (`{word}`)
- `src/world.ts` — `BasicWorld<Given, When, Then>` with `MergeableWorldState` (lodash deep merge, arrays concatenate)
- `src/builderTypeUtils.ts` — TypeScript utility types driving the builder's type safety
- `src/utils.ts` — `requireFrom{Given,When,Then}()` for runtime required-dependency validation

#### Runtime (`src/runtime/`)

- `registry.ts` — `StepRegistry` and the `globalRegistry` singleton. Steps register here; the engine reads from here.
- `engine.ts` — `runScenario(scenario, registry, makeWorld)`: matches each Gherkin step via a `CucumberExpression` (strict — undefined and ambiguous both throw), hands parsers the **raw** captured text (`arg.group.value`), runs the step against a fresh world per scenario, and skips remaining steps after the first failure.
- `vitest.ts` — `stepForge()` Vite/Vitest plugin (transforms each `.feature` into a native Vitest test module) and the `defineStepForgeConfig()` one-line config preset.
- `index.ts` — the `@step-forge/step-forge/runtime` barrel (runner-agnostic core for building other adapters).

### Testing

Tests run through the **Vitest plugin** (`src/runtime/vitest.ts`), configured in `vitest.config.ts` via `defineStepForgeConfig`. The plugin compiles each `.feature` file into a Vitest test module (feature → `describe`, scenario → `test`), injecting `import`s of the step-definition modules so they self-register. Each scenario is a native Vitest task, so watch mode / `--ui` / filtering / coverage all work.

Type-safety tests use `@ts-expect-error` annotations validated at `tsc` compile time (`npm run build` runs `tsc --noEmit`), not at runtime.

**Current coverage is `features/basic.feature` only.** `vitest.config.ts` scopes the plugin to `features/basic.feature` + `features/steps/commonSteps.ts`. The other feature files are not yet wired into the native runner:

- `features/exported.feature` / `placeholders.feature` — builder-pattern demos (IDE-integration examples); not currently executed.
- `features/analyzer/**` and `features/steps/analyzerSteps.ts` — the analyzer's self-tests, still written against raw `@cucumber/cucumber` `Given/When/Then` and **not yet ported** to the native runner.

Migrating these into the Vitest plugin (and porting `analyzerSteps.ts` off raw Cucumber) is outstanding follow-up work. `cucumber.mjs` and the residual `@cucumber/cucumber` dependency remain only for those un-ported paths.

In-repo, `vitest.config.ts` passes a `runtimeModule` override pointing at `src/runtime/index.ts` so the generated tests and the builders resolve the **same** `globalRegistry` from source. Consumers never need this.

### Analyzer

The analyzer (`src/analyzer/`) statically checks `.feature` files against step definitions without running them. It parses features with `@cucumber/gherkin` (`gherkinParser.ts`), extracts step metadata from TypeScript source via the AST (`stepExtractor.ts`, keyed off the terminal `.step(...)` call), matches them (`stepMatcher.ts`), and runs rules (`rules/`). Exposed as the `analyze()` API (`@step-forge/step-forge/analyzer`) and the `step-forge-analyze` CLI.

### Build Output

`tsdown` (configured in `tsdown.config.ts`, powered by rolldown) produces JS bundles and bundled type declarations in one pass. Two build groups:

1. **`step-forge` (main) + `runtime`** — ESM + CJS. Built together **on purpose**: the step registry is emitted as a single shared chunk (`registry-*.js`) so the builders (main entry) and `runScenario` (runtime entry) share the **same** `globalRegistry` instance. Splitting them would silently break registration.
2. **`analyzer` + `analyzer-cli` + `vitest`** — ESM only.

Dependencies and `node:` builtins are externalized automatically. The `build/` directory is the publishable package.

## Exports

- `@step-forge/step-forge` — `givenBuilder`, `whenBuilder`, `thenBuilder`, `BasicWorld`, the parsers (`stringParser`, `intParser`, `numberParser`, `booleanParser`), `createBuilders`, and types (`Parser`, `StateFromDependencies`, …). From `src/index.ts`.
- `@step-forge/step-forge/vitest` — `stepForge()` plugin and `defineStepForgeConfig()` preset.
- `@step-forge/step-forge/runtime` — `runScenario`, `StepRegistry`, `globalRegistry`, `UndefinedStepError`, `AmbiguousStepError`, and their types.
- `@step-forge/step-forge/analyzer` — `analyze()` and related APIs.

`vitest` is an optional peer dependency (needed only for the `/vitest` entry).
