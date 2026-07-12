# Testing

All tests run natively under **Bun** in a self-testing pattern: feature files in `features/` with step definitions in `features/steps/` exercise the library, executed by the native runner (`src/runtime/cli.ts`) configured via `step-forge.config.ts`. There is no Vitest and no Cucumber.js runtime involved. Runtime internals also have `bun:test` unit tests (`src/**/*.test.ts`, run with `bun test src`).

## Test Scripts

| Script                  | Description                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `bun run test`          | Runtime unit tests (`bun test`) then all feature tests (the Bun runner). Normal development.        |
| `bun run test:unit`     | Runtime unit tests only (`bun test src/runtime`).                                                   |
| `bun run test:features` | Feature tests only (`bun src/runtime/cli.ts`). The default `pretty` reporter shows per-step detail. |
| `bun run test:ci`       | Alias for `bun run test`.                                                                           |

Use `bun run test`, not `bun test` (the latter is Bun's native runner and would skip the feature suite). Run a subset by passing globs or filters to the runner: `bun src/runtime/cli.ts features/basic.feature` (by file), `--name "part of the scenario name"` (by name), or `--tags "@foo and not @bar"` (by tag).

## Directory Structure

```
features/
  basic.feature                   ← Builder pattern tests (variables, deps, state)
  exported.feature                ← Re-exported builder tests
  steps/
    commonSteps.ts                ← Step defs for basic.feature
    exportedSteps.ts              ← Step defs for exported.feature
    analyzerSteps.ts              ← Step defs for analyzer tests (native builders)
    analyzerWorld.ts              ← World state types for the analyzer tests
    makeWorld.ts                  ← World factory for the native runtime
    world.ts                      ← World state types for basic.feature
  analyzer/
    analyzer.feature              ← Analyzer test scenarios (run by the native runner)
    fixtures/
      steps.ts                    ← Fixture step definitions (data, NOT executed)
      valid-no-deps.feature       ← Fixture feature files (data, NOT executed as tests)
      valid-deps.feature
      ...
```

## Builder Tests

`basic.feature` and `exported.feature` test the core builder pattern — step registration, variable extraction, dependency resolution, and state merging. Their step definitions in `features/steps/` use the builders directly and assert on the resulting world state.

Type-safety tests in `test/` use `@ts-expect-error` annotations and validate at `tsc` compile time, not at runtime.

## Analyzer Tests

The analyzer test suite under `features/analyzer/` tests the `analyze()` API against fixture files. The key distinction: **fixture files are data, not tests**. The analyzer's extractor reads `fixtures/steps.ts` as a TypeScript AST, and the parser reads `fixtures/*.feature` as Gherkin data. The runner never executes them.

`step-forge.config.ts` lists `features` as **exact** file paths (`features/basic.feature`, `features/tags.feature`, `features/analyzer/analyzer.feature`) rather than a recursive glob, so fixture files in `features/analyzer/fixtures/` are never discovered as scenarios. The analyzer steps live in `features/steps/analyzerSteps.ts`, built with the same `givenBuilder`/`whenBuilder`/`thenBuilder` as any other steps — the two `Given`s record the fixture paths in world state, `When I analyze the files` runs `analyze()` and produces the diagnostics, and each `Then` reads them from `when.diagnostics`.

### Available Steps

Step definitions in `features/steps/analyzerSteps.ts` provide:

| Step                                      | Purpose                                                |
| ----------------------------------------- | ------------------------------------------------------ |
| `Given step definitions from {string}`    | Set the fixture step file (relative to `fixtures/`)    |
| `Given a feature file {string}`           | Set the fixture feature file (relative to `fixtures/`) |
| `When I analyze the files`                | Call `analyze()` with the configured files             |
| `Then there should be no errors`          | Assert zero errors in diagnostics                      |
| `Then there should be {int} error/errors` | Assert exact error count                               |
| `Then an error should mention {string}`   | Assert an error message contains the substring         |

### Adding New Analyzer Tests

1. **Add step definition patterns** (if needed) to `features/analyzer/fixtures/steps.ts`. This file must be valid TypeScript that compiles, but it is never executed — only parsed by the AST extractor.

2. **Create a fixture feature file** in `features/analyzer/fixtures/` using the step expressions from `steps.ts`. This file is parsed by the Gherkin parser as data.

3. **Add a scenario** to `features/analyzer/analyzer.feature`:

   ```gherkin
   Scenario: Description of what you're testing
     Given a feature file "your-new-fixture.feature"
     When I analyze the files
     Then there should be no errors
   ```

   The Background already provides `Given step definitions from "steps.ts"`, so you only need the `Given a feature file` line in each scenario.

4. **Run `bun run test:features`** to verify. The default `pretty` reporter prints each step with pass/fail marks and a `.feature` code frame on failure.

### Fixture Step Definitions

`features/analyzer/fixtures/steps.ts` contains builder calls covering these patterns:

| Expression                    | Type  | Dependencies              | Produces  |
| ----------------------------- | ----- | ------------------------- | --------- |
| `a user`                      | given | none                      | `user`    |
| `a user named {string}`       | given | none                      | `user`    |
| `an account`                  | given | none                      | `account` |
| `I started`                   | given | none                      | (nothing) |
| `I save the user`             | when  | `given.user: required`    | `user`    |
| `I delete the account`        | when  | `given.account: required` | `result`  |
| `I got here`                  | when  | none                      | (nothing) |
| `everything was good`         | then  | none                      | (nothing) |
| `there is a user`             | then  | `when.user: required`     | (nothing) |
| `the user's name is {string}` | then  | `when.user: required`     | (nothing) |
| `the account might exist`     | then  | `given.account: optional` | (nothing) |

When adding new patterns, add them to this file and they'll be available to all fixture feature files.
