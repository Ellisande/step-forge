1. Data tables / doc strings — gherkinParser.ts:122 drops them; need to thread table/docString into the step input object (the opinionated first-class version).
2. Hooks — no Before/After/BeforeAll yet; map to beforeEach/beforeAll in the generated describe.
3. Source maps — errors currently prepend file:line as text rather than a real .feature sourcemap.
4. The Cucumber try/catch in common.ts is a transitional bridge — the final step is deleting the adapter and the @cucumber/cucumber dep outright.
5. Parser/ParameterType unification — parsers currently re-coerce on top of cucumber-expression captures (works because they tolerate both); folding Parser<T> into a ParameterType is still open.
6. Tags (@skip/@only) and scenario-outline test.each labels not mapped yet.
7. Plugin uses process.cwd() for root — add a configResolved hook before this is real.
