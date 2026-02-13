# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                # Run all tests (Cucumber.js, suppresses stderr)
npm run test:debug      # Run all tests with full output (use when debugging failures)
npm run test:cucumber   # Run with default Cucumber profile
npm run test:ci         # Run with CI profile
npm run build           # Full build: clean → tsc → rolldown → dts-bundle-generator → copy
npm run lint            # ESLint
npm run format          # Prettier
```

## Architecture

Step Forge is a TypeScript library that wraps Cucumber.js with a type-safe builder pattern for step definitions.

### Builder Chain

Each Gherkin phase (given/when/then) has a builder that follows this chain:

```
builder<State>().statement(str | fn) → .dependencies?(deps) → .step(fn) → .register()
```

- **Statement**: A string or function. Functions define variables via parameters: `(name: string) => \`a user named ${name}\`` — each parameter becomes a `{string}` placeholder in the Gherkin expression.
- **Dependencies**: Declare which keys from other phases' state this step needs. Keys are marked `"required"` or `"optional"`. Required deps are validated at runtime; optional ones may be `undefined`.
- **Step function**: Receives `{ variables, given, when, then }` — only the phases allowed by the builder type are accessible (given steps can't access when/then state).
- **Register**: Calls the corresponding Cucumber.js `Given`/`When`/`Then` to wire everything up.

### Phase Restrictions

- `givenBuilder` — dependencies on `given` only, returns `Partial<GivenState>`
- `whenBuilder` — dependencies on `given` and `when`, returns `Partial<WhenState>`
- `thenBuilder` — dependencies on all three phases, returns `Partial<ThenState> | void`

### Key Source Files

- `src/common.ts` — `addStep()`: core registration that wires parsers, dependency validation, and state merging into Cucumber
- `src/given.ts`, `src/when.ts`, `src/then.ts` — Builder implementations with phase-specific type constraints
- `src/world.ts` — `BasicWorld<Given, When, Then>` with `MergeableWorldState` (lodash deep merge, arrays concatenate)
- `src/builderTypeUtils.ts` — TypeScript utility types driving the builder's type safety
- `src/utils.ts` — `typeCoercer()` for string→typed conversion, `requireFrom{Given,When,Then}()` for runtime dep validation

### Testing

Tests use Cucumber.js itself (self-testing). Feature files in `features/` with step definitions in `features/steps/` exercise the library. Type-safety tests in `test/` use `@ts-expect-error` annotations — they validate at `tsc` compile time, not at runtime.

#### Test Scripts

| Script | Profile | Description |
|---|---|---|
| `npm test` | `all` | Run all tests. Suppresses stderr (`2> /dev/null`) for clean output. Use this for normal development. |
| `npm run test:debug` | `all` | Run all tests with full output (stderr included). Use this when a test fails and you need stack traces or error details. |
| `npm run test:cucumber` | `default` | Run tests using the `default` Cucumber profile. Same paths as `all`, but does not set `PORT` or `LOG_LEVEL`. |
| `npm run test:ci` | `ci` | CI-oriented profile. Does not import `src/**/*.ts` (only step defs). Enables `publish`. |

All profiles run with `parallel: 1` and use `tsx` as the TypeScript loader via `NODE_OPTIONS='--import tsx'`.

There is no way to run a single test file. To run a subset, use Cucumber tags or modify the feature files temporarily.

#### Analyzer Tests

The analyzer has its own test suite under `features/analyzer/` that tests the `analyze()` API against fixture files. The fixtures are **data** — they are read by the analyzer's extractor and parser, not executed by Cucumber.

```
features/analyzer/
  analyzer.feature                ← Test scenarios (run by Cucumber)
  fixtures/
    steps.ts                      ← Fixture step definitions (read by extractor as data)
    valid-no-deps.feature         ← Fixture feature files (read by parser as data)
    valid-deps.feature
    missing-given-dep.feature
    ...
```

The `cucumber.mjs` config uses non-recursive path globs (`./features/*.feature`, `./features/analyzer/*.feature`) to ensure fixture files in `features/analyzer/fixtures/` are never executed as tests.

Step definitions in `features/steps/analyzerSteps.ts` provide these steps:

- `Given step definitions from {string}` — sets the fixture step file (relative to `fixtures/`)
- `Given a feature file {string}` — sets the fixture feature file (relative to `fixtures/`)
- `When I analyze the files` — calls `analyze()` with the configured files
- `Then there should be no errors` — asserts zero errors
- `Then there should be {int} error/errors` — asserts exact error count
- `Then an error should mention {string}` — asserts an error message contains the substring

#### Adding New Analyzer Tests

1. **If you need new step definition patterns**, add builder calls to `features/analyzer/fixtures/steps.ts`. This file is only parsed by the TypeScript AST extractor — it is never executed, but it must be valid TypeScript that compiles.

2. **Create a fixture feature file** in `features/analyzer/fixtures/` that uses the step expressions defined in `steps.ts`. This file is parsed by the Gherkin parser as data — Cucumber never runs it.

3. **Add a scenario** to `features/analyzer/analyzer.feature`:
   ```gherkin
   Scenario: Description of what you're testing
     Given step definitions from "steps.ts"
     Given a feature file "your-new-fixture.feature"
     When I analyze the files
     Then there should be no errors
   ```
   The Background already provides `step definitions from "steps.ts"`, so you only need the `Given a feature file` line in each scenario.

4. **Run `npm run test:debug`** to verify. Use `test:debug` instead of `npm test` so you can see error details if something fails.

### Build Output

Vite produces ESM (`dist/step-forge.js`) and `dts-bundle-generator` creates a single `dist/index.d.ts`. The `build/` directory contains the publishable package.

## Exports

`givenBuilder`, `whenBuilder`, `thenBuilder`, `BasicWorld` — all from `src/index.ts`.
