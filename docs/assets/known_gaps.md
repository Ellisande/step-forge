1. ~~Data tables~~ — DONE. Declared per-step via a `.table(tableParser)` builder stage (a `TableParser<T>` owns coercion, mirroring `Parser<T>`); the parsed value surfaces as a typed `input.table`. Strict: a declared table demands one in the feature and vice-versa. Doc strings deferred — not needed yet.
2. Hooks — no Before/After/BeforeAll yet; map to beforeEach/beforeAll in the generated describe.
3. Source maps — errors currently prepend file:line as text rather than a real .feature sourcemap.
4. The Cucumber try/catch in common.ts is a transitional bridge — the final step is deleting the adapter and the @cucumber/cucumber dep outright.
5. Parser/ParameterType unification — parsers currently re-coerce on top of cucumber-expression captures (works because they tolerate both); folding Parser<T> into a ParameterType is still open.
6. Tags (@skip/@only) and scenario-outline test.each labels not mapped yet.
7. Plugin uses process.cwd() for root — add a configResolved hook before this is real.
