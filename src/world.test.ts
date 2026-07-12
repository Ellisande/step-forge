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
});

test("merging an array concatenates into a new array (no per-index merge)", () => {
  const world = new BasicWorld<
    { list: number[]; n: number },
    unknown,
    unknown
  >();
  world.mergeInto("given", { list: [1], n: 1 });
  const firstList = (world.given as { list: number[] }).list;

  world.mergeInto("given", { list: [2, 3] });

  const given = world.given as { list: number[]; n: number };
  expect(given.list).toEqual([1, 2, 3]); // old-then-new, not index-merged to [2, 3]
  expect(given.n).toBe(1); // untouched keys survive
  expect(firstList).toEqual([1]); // the earlier array object is left untouched
});

test("merging nested plain objects deep-merges rather than replacing", () => {
  const world = new BasicWorld<
    { o: { a: number; b?: number } },
    unknown,
    unknown
  >();
  world.mergeInto("given", { o: { a: 1 } });
  world.mergeInto("given", { o: { b: 2 } });

  expect((world.given as { o: { a: number; b: number } }).o).toEqual({
    a: 1,
    b: 2,
  });
});

test("overwriting an existing scalar with a different value throws", () => {
  const world = new BasicWorld<{ a: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });

  expect(() => world.mergeInto("given", { a: 2 })).toThrow(
    /Merge would have destroyed previous value/
  );
  // Re-merging the same value is fine (no destruction).
  expect(() => world.mergeInto("given", { a: 1 })).not.toThrow();
});

test("overwriting a falsy scalar with a different value is allowed", () => {
  // The destroy guard only fires for a *truthy* previous value, so 0 → 5 is a
  // plain overwrite. Pinned because the shallow-merge fast path must match this.
  const world = new BasicWorld<{ a: number; ok: boolean }, unknown, unknown>();
  world.mergeInto("given", { a: 0, ok: false });
  world.mergeInto("given", { a: 5, ok: true });

  const given = world.given as { a: number; ok: boolean };
  expect(given.a).toBe(5);
  expect(given.ok).toBe(true);
});

test("an empty merge is a no-op and never throws", () => {
  const world = new BasicWorld<{ a: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });

  expect(() => world.mergeInto("given", {})).not.toThrow();
  expect((world.given as { a: number }).a).toBe(1);
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
  const world = new BasicWorld<{ a: number; b?: number }, unknown, unknown>();
  world.mergeInto("given", { a: 1 });

  const before = world.given as { a: number; b?: number }; // snapshot taken now
  world.mergeInto("given", { b: 2 }); // later write adds a new key

  expect(before.a).toBe(1);
  expect(before.b).toBeUndefined(); // old snapshot didn't gain the later key
  expect(world.readState("given").b).toBe(2); // live read sees the new value
  expect((world.given as { b: number }).b).toBe(2);
});

test("phases are isolated from one another", () => {
  const world = new BasicWorld<{ x: number }, { x: number }, unknown>();
  world.mergeInto("given", { x: 1 });
  world.mergeInto("when", { x: 2 });

  expect((world.given as { x: number }).x).toBe(1);
  expect((world.when as { x: number }).x).toBe(2);
});
