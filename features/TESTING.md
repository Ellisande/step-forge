# Testing

All tests use Cucumber.js in a self-testing pattern: feature files in `features/` with step definitions in `features/steps/` exercise the library.

## Test Scripts

| Script                  | Profile   | Description                                                                                                         |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm test`              | `all`     | Run all tests. Suppresses stderr for clean output. Use for normal development.                                      |
| `npm run test:debug`    | `all`     | Run all tests with full output (stderr included). Use when a test fails and you need stack traces or error details. |
| `npm run test:cucumber` | `default` | Same paths as `all`, but does not set `PORT` or `LOG_LEVEL`.                                                        |
| `npm run test:ci`       | `ci`      | CI-oriented profile. Does not import `src/**/*.ts` (only step defs). Enables `publish`.                             |

All profiles run with `parallel: 1` and use `tsx` as the TypeScript loader.

There is no way to run a single test file. To run a subset, use Cucumber tags or modify the feature files temporarily.

## Directory Structure

```
features/
  basic.feature                   ← Builder pattern tests (variables, deps, state)
  exported.feature                ← Re-exported builder tests
  steps/
    commonSteps.ts                ← Step defs for basic.feature
    exportedSteps.ts              ← Step defs for exported.feature
    analyzerSteps.ts              ← Step defs for analyzer tests
    world.ts                      ← World state types
  analyzer/
    analyzer.feature              ← Analyzer test scenarios (run by Cucumber)
    fixtures/
      steps.ts                    ← Fixture step definitions (data, NOT run by Cucumber)
      valid-no-deps.feature       ← Fixture feature files (data, NOT run by Cucumber)
      valid-deps.feature
      ...
```

## Builder Tests

`basic.feature` and `exported.feature` test the core builder pattern — step registration, variable extraction, dependency resolution, and state merging. Their step definitions in `features/steps/` use the builders directly and assert on the resulting world state.

Type-safety tests in `test/` use `@ts-expect-error` annotations and validate at `tsc` compile time, not at runtime.

## Analyzer Tests

The analyzer test suite under `features/analyzer/` tests the `analyze()` API against fixture files. The key distinction: **fixture files are data, not tests**. The analyzer's extractor reads `fixtures/steps.ts` as a TypeScript AST, and the parser reads `fixtures/*.feature` as Gherkin data. Cucumber never executes them.

The `cucumber.mjs` config uses non-recursive path globs (`./features/*.feature`, `./features/analyzer/*.feature`) so fixture files in `features/analyzer/fixtures/` are excluded from Cucumber's test discovery.

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

4. **Run `npm run test:debug`** to verify. Use `test:debug` instead of `npm test` so you can see error details if something fails.

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
