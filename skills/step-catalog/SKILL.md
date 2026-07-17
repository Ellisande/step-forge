---
name: step-catalog
description: Look up existing Step Forge step definitions — what steps exist, what state each consumes and produces, and how to chain them into a valid scenario. Use whenever writing or editing Gherkin .feature files or step definitions in a project that depends on @step-forge/step-forge; before defining any new step (an existing one may already fit); when an analyzer or runtime error mentions missing state like "given.user is required"; or when asked what steps are available. Even for small scenario edits, check the catalog first — reusing an existing step beats redefining it.
---

# Step Forge Step Catalog

A Step Forge project defines typed Gherkin steps with a builder API. Each step declares the
state it **consumes** from earlier steps (`.dependencies()`) and **produces** for later ones
(its return value). The catalog CLI statically extracts all of this — no project code is
executed — so you can find reusable steps and order them so every dependency is satisfied,
instead of guessing from grep results.

## Querying

Run from the project root. Step-file globs are read from `step-forge.config.ts`
automatically, so no flags are needed to see everything:

```bash
bunx step-forge-analyze catalog
```

If the project has its own catalog script in `package.json` (common; often named
`catalog`), prefer it: `bun run catalog`. Extra flags pass straight through either way.
If neither works — e.g. you are inside the step-forge library repo itself, where the bin
isn't linked — run the CLI entry directly: `bun src/analyzer/cli.ts catalog`.

Filters — combine freely, they AND together:

| Flag | Meaning |
| --- | --- |
| `--type given\|when\|then` | step phase |
| `--text <substring>` | case-insensitive match on the expression |
| `--consumes <spec>` | consumed state: `user` (any phase), `given.user`, `given.user:required` |
| `--produces <key>` | produced state key (exact match) |
| `--source <substring>` | source file path |
| `--json` | machine-readable envelope `{ version, steps }` |

The human-readable default is easiest to scan; add `--json` when you need exact dependency
maps or source locations to cite.

## Reading an entry

```json
{
  "stepType": "when",
  "expression": "I deposit {int} {string}",
  "dependencies": { "given": { "user": "required" }, "when": {}, "then": {} },
  "produces": ["deposit"],
  "sourceFile": "/abs/path/features/steps/commonSteps.ts",
  "line": 133
}
```

- `expression` is the cucumber expression to use in the `.feature` file, with concrete
  values in place of the placeholders: `{int}` → `500`, `{string}` → `"USD"` (keep the
  quotes), and custom placeholders like `{color}` only match the values their parser's
  regex allows.
- `dependencies` is the state this step requires. Every `required` `phase.key` must be
  produced by an **earlier step of that phase** in the same scenario, or the step fails.
- `produces` lists the state keys the step adds for later steps. It is best-effort static
  inference: an empty list usually means the step adds nothing, but can also mean its
  return shape wasn't statically visible.

## Workflows

**Writing or extending a scenario**

1. Search by intent: `bun run catalog --text transfer`, or `--type when` to see the actions.
2. For each step you pick, satisfy its dependencies: if it requires `given.user`, find a
   producer with `--produces user --type given` and place it earlier in the scenario.
   Follow the chain — the producer may have requirements of its own.
3. Only define a new step when no existing expression fits. When you do, mirror the state
   keys of nearby steps (same `produces`/`dependencies` vocabulary) so it chains with them.

**Fixing a missing-dependency error** — e.g. the analyzer reports `when.deposit is
required` but nothing produces it: run `--produces deposit --type when`, pick a producing
step, and insert it before the failing step (then satisfy *its* dependencies the same way).

**Answering "what steps are available"** — run with no filters, group by `stepType`, and
cite `sourceFile:line` from `--json` output so readers can jump to each definition.
