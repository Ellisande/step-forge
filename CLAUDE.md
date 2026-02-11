# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                # Run all tests (Cucumber.js, suppresses stderr)
npm run test:debug      # Run all tests with full output
npm run test:cucumber   # Run with explicit ts-node loader
npm run build           # Full build: clean → tsc → vite → dts-bundle-generator → copy
npm run lint            # ESLint
npm run format          # Prettier
```

There is no way to run a single test file. Tests are Cucumber feature files in `features/` and run via `cucumber-js`. To run a subset, use Cucumber tags or modify the feature files temporarily.

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

### Testing Pattern

Tests use Cucumber.js itself (self-testing). Feature files in `features/` with step definitions in `features/steps/` exercise the library. Type-safety tests in `test/` use `@ts-expect-error` annotations — they validate at `tsc` compile time, not at runtime.

### Build Output

Vite produces ESM (`dist/step-forge.js`) and `dts-bundle-generator` creates a single `dist/index.d.ts`. The `build/` directory contains the publishable package.

## Exports

`givenBuilder`, `whenBuilder`, `thenBuilder`, `BasicWorld` — all from `src/index.ts`.
