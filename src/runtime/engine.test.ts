import { test, expect } from "bun:test";
import {
  compileRegistry,
  runScenario,
  UndefinedStepError,
  AmbiguousStepError,
} from "./engine";
import { RegisteredStep, StepRegistry } from "./registry";
import { intParser } from "../parsers";
import { BasicWorld } from "../world";
import type { ParsedScenario } from "../analyzer/types";

/**
 * Tests for the `(stepType, text)` match cache in `matchStep`. Matching is the
 * dominant runtime cost, so resolution is memoized across the run; these pin the
 * two things a cache could get wrong: it must still throw for repeated
 * undefined/ambiguous steps, and it must NOT cache captured argument *values*
 * (which a step could mutate) — each execution re-derives fresh args.
 */

const givenStep = (
  expression: string,
  execute: RegisteredStep["execute"],
  parsers: RegisteredStep["parsers"] = []
): RegisteredStep => ({ stepType: "given", expression, parsers, execute });

function scenario(text: string, file = "f.feature"): ParsedScenario {
  return {
    name: text,
    file,
    steps: [
      { keyword: "Given", effectiveKeyword: "Given", text, line: 1, column: 1 },
    ],
    tags: [],
  };
}

const makeWorld = () => new BasicWorld();

test("a repeated step text re-derives fresh args instead of caching them", async () => {
  const captured: unknown[][] = [];
  const reg = new StepRegistry();
  reg.add(
    givenStep(
      "record {int}",
      async (_world, args) => void captured.push(args),
      [intParser]
    )
  );
  const compiled = compileRegistry(reg);

  // Same text twice → second is a cache hit. Both must coerce to 5, but the two
  // arg arrays must be distinct objects (a mutation in one can't reach the other).
  await runScenario(scenario("record 5"), compiled, makeWorld);
  await runScenario(scenario("record 5"), compiled, makeWorld);

  expect(captured).toHaveLength(2);
  expect(captured[0]).toEqual([5]);
  expect(captured[1]).toEqual([5]);
  expect(captured[0]).not.toBe(captured[1]); // fresh array, not the cached one
});

test("a cached hit resolves to the right definition and coerced args", async () => {
  const reg = new StepRegistry();
  reg.add(
    givenStep(
      "add {int}",
      async (world, args) =>
        void world.mergeInto?.("given", { sum: args[0] as number }),
      [intParser]
    )
  );
  const compiled = compileRegistry(reg);

  const first = await runScenario(scenario("add 7"), compiled, makeWorld);
  const second = await runScenario(scenario("add 7"), compiled, makeWorld);

  expect(first.status).toBe("passed");
  expect(second.status).toBe("passed");
});

test("a repeated undefined step throws every time (cached negative)", async () => {
  const reg = new StepRegistry();
  reg.add(givenStep("a known step", async () => {}));
  const compiled = compileRegistry(reg);

  const first = await runScenario(
    scenario("an unknown step"),
    compiled,
    makeWorld
  );
  const second = await runScenario(
    scenario("an unknown step"),
    compiled,
    makeWorld
  );

  expect(first.error).toBeInstanceOf(UndefinedStepError);
  expect(second.error).toBeInstanceOf(UndefinedStepError);
});

test("a repeated ambiguous step throws every time and reports all matches", async () => {
  const reg = new StepRegistry();
  reg.add(givenStep("hello", async () => {}));
  reg.add(givenStep("hello", async () => {}));
  const compiled = compileRegistry(reg);

  const first = await runScenario(scenario("hello"), compiled, makeWorld);
  const second = await runScenario(scenario("hello"), compiled, makeWorld);

  expect(first.error).toBeInstanceOf(AmbiguousStepError);
  expect(second.error).toBeInstanceOf(AmbiguousStepError);
  expect((first.error as AmbiguousStepError).matches).toHaveLength(2);
});

/**
 * Candidate indexing prunes the per-step scan to definitions "anchored" on the
 * step text's first token. These pin the soundness boundary: an expression that
 * does NOT begin with a fixed literal word (parameter-first, or a leading
 * alternation) must stay always-scanned, or it would be wrongly pruned for text
 * whose first token varies.
 */
test("a parameter-first expression matches even though its first token varies", async () => {
  const reg = new StepRegistry();
  reg.add(
    givenStep(
      "{int} coins remain",
      async (world, args) =>
        void world.mergeInto?.("given", { coins: args[0] as number })
    )
  );
  const compiled = compileRegistry(reg);

  // First tokens "5" and "9" differ and match no literal anchor — the def must
  // still be scanned for both.
  const a = await runScenario(scenario("5 coins remain"), compiled, makeWorld);
  const b = await runScenario(scenario("9 coins remain"), compiled, makeWorld);

  expect(a.status).toBe("passed");
  expect(b.status).toBe("passed");
});

test("a leading-alternation expression matches every alternant", async () => {
  const reg = new StepRegistry();
  reg.add(givenStep("a/an owl appears", async () => {}));
  const compiled = compileRegistry(reg);

  // "a" and "an" are different first tokens; anchoring on either would drop the
  // other, so the def must be treated as unanchored.
  const a = await runScenario(scenario("a owl appears"), compiled, makeWorld);
  const b = await runScenario(scenario("an owl appears"), compiled, makeWorld);

  expect(a.status).toBe("passed");
  expect(b.status).toBe("passed");
});

test("anchored definitions still resolve for their own first token", async () => {
  const reg = new StepRegistry();
  reg.add(givenStep("the cart is empty", async () => {}));
  reg.add(givenStep("a widget exists", async () => {}));
  const compiled = compileRegistry(reg);

  const ok = await runScenario(
    scenario("the cart is empty"),
    compiled,
    makeWorld
  );
  // A different first token must not accidentally match the anchored "the" def.
  const miss = await runScenario(scenario("no cart here"), compiled, makeWorld);

  expect(ok.status).toBe("passed");
  expect(miss.error).toBeInstanceOf(UndefinedStepError);
});
