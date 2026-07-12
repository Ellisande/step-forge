import { test, expect } from "bun:test";
import { BasicWorld } from "./world";

/**
 * The load-bearing invariant of the world: **the only way to change world state
 * is a step's return value flowing through `merge`/`mergeInto`.** Reading state —
 * whether through the public `given`/`when`/`then` getters (what hooks see) or
 * the engine's `readState` fast-path — must never give a handle that mutates the
 * store by reference. These tests pin that guarantee so the getter-cloning /
 * fast-path optimizations can't silently regress it.
 */

test("mutating the object returned by a getter does not change world state", () => {
  const world = new BasicWorld<{ a: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });

  const snapshot = world.given as { a: number };
  snapshot.a = 999; // reassign a top-level key on the returned snapshot

  expect((world.given as { a: number }).a).toBe(1); // store is untouched
});

test("mergeInto accumulates keys across successive merges", () => {
  const world = new BasicWorld<{ a: number; b: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });
  world.mergeInto("given", { b: 2 });

  const given = world.given as { a: number; b: number };
  expect(given.a).toBe(1); // earlier key survives a later merge
  expect(given.b).toBe(2); // later key is added
  // NB: nested-array/scalar merge follows lodash `_.merge` (last-writer-per-path).
  // The `mergeCustomizer` (array-concat / destructive-merge guard) is currently
  // inert because the code calls `_.merge(dest, src, customizer)`, where lodash
  // treats `customizer` as an extra source rather than a merge customizer — it
  // would need `_.mergeWith`. Pinned here only so the perf work doesn't change it.
});

test("the getter's merge and mergeInto write to the same store", () => {
  const world = new BasicWorld<{ a: number; b: number }, unknown, unknown>();
  world.given.merge({ a: 1 });
  world.mergeInto("given", { b: 2 });

  const given = world.given as { a: number; b: number };
  expect(given.a).toBe(1);
  expect(given.b).toBe(2);
});

test("readState reflects current state but a prior snapshot stays frozen in time", () => {
  const world = new BasicWorld<{ a: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });

  const before = world.given as { a: number }; // snapshot taken now
  world.mergeInto("given", { a: 2 }); // later write replaces the store

  expect(before.a).toBe(1); // old snapshot untouched by the later merge
  expect(world.readState("given").a).toBe(2); // live read sees the new value
  expect((world.given as { a: number }).a).toBe(2);
});

test("phases are isolated from one another", () => {
  const world = new BasicWorld<{ x: number }, { x: number }, unknown>();
  world.mergeInto("given", { x: 1 });
  world.mergeInto("when", { x: 2 });

  expect((world.given as { x: number }).x).toBe(1);
  expect((world.when as { x: number }).x).toBe(2);
});
