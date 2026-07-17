import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, filterCatalog } from "./catalog";
import type { CatalogEntry } from "./catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureStepFile = path.resolve(
  __dirname,
  "../../features/analyzer/fixtures/steps.ts"
);

describe("buildCatalog", () => {
  const catalogPromise = buildCatalog({ stepFiles: [fixtureStepFile] });

  it("returns the versioned envelope", async () => {
    const catalog = await catalogPromise;
    expect(catalog.version).toBe(1);
    expect(catalog.steps.length).toBeGreaterThan(0);
  });

  it("assigns each entry a stable sourceFile:line id", async () => {
    const catalog = await catalogPromise;
    for (const entry of catalog.steps) {
      expect(entry.id).toBe(`${entry.sourceFile}:${entry.line}`);
    }
  });

  it("sorts entries by source file and line", async () => {
    const catalog = await catalogPromise;
    const sorted = [...catalog.steps].sort(
      (a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.line - b.line
    );
    expect(catalog.steps).toEqual(sorted);
  });

  it("infers produced keys from step return values", async () => {
    const catalog = await catalogPromise;
    const producesOf = (expression: string) =>
      catalog.steps.find(s => s.expression === expression)?.produces;
    expect(producesOf("a user")).toEqual(["user"]);
    expect(producesOf("I deposit {int} {string}")).toEqual(["result"]);
    expect(producesOf("I save the user")).toEqual(["user"]);
    expect(producesOf("my favorite color is {color}")).toEqual([
      "favoriteColor",
    ]);
    expect(producesOf("everything was good")).toEqual([]);
  });

  it("returns an empty catalog when no files match", async () => {
    const catalog = await buildCatalog({
      stepFiles: [path.join(__dirname, "no-such-file.ts")],
    });
    expect(catalog).toEqual({ version: 1, steps: [] });
  });
});

function def(overrides: Partial<CatalogEntry>): CatalogEntry {
  return {
    stepType: "given",
    expression: "a step",
    dependencies: { given: {}, when: {}, then: {} },
    produces: [],
    sourceFile: "/steps.ts",
    line: 1,
    id: "/steps.ts:1",
    ...overrides,
  };
}

describe("filterCatalog", () => {
  const entries: CatalogEntry[] = [
    def({
      expression: "a user",
      produces: ["user"],
      sourceFile: "/users.steps.ts",
    }),
    def({
      stepType: "when",
      expression: "I save the user",
      dependencies: { given: { user: "required" }, when: {}, then: {} },
      produces: ["user"],
      line: 10,
      id: "/steps.ts:10",
    }),
    def({
      stepType: "then",
      expression: "the account might exist",
      dependencies: { given: { account: "optional" }, when: {}, then: {} },
      line: 20,
      id: "/steps.ts:20",
    }),
    def({
      stepType: "then",
      expression: "there is a user",
      dependencies: { when: { user: "required" }, given: {}, then: {} },
      line: 30,
      id: "/steps.ts:30",
    }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterCatalog(entries, {})).toEqual(entries);
  });

  it("filters by step type", () => {
    const result = filterCatalog(entries, { stepType: "then" });
    expect(result.map(e => e.expression)).toEqual([
      "the account might exist",
      "there is a user",
    ]);
  });

  it("filters by expression text, case-insensitively", () => {
    const result = filterCatalog(entries, { text: "SAVE THE" });
    expect(result.map(e => e.expression)).toEqual(["I save the user"]);
  });

  it("filters by source file substring", () => {
    const result = filterCatalog(entries, { sourceFile: "users.steps" });
    expect(result.map(e => e.expression)).toEqual(["a user"]);
  });

  it("matches a bare consumed key across all phases", () => {
    const result = filterCatalog(entries, { consumes: { key: "user" } });
    expect(result.map(e => e.expression)).toEqual([
      "I save the user",
      "there is a user",
    ]);
  });

  it("restricts a consumed key to one phase", () => {
    const result = filterCatalog(entries, {
      consumes: { key: "user", phase: "when" },
    });
    expect(result.map(e => e.expression)).toEqual(["there is a user"]);
  });

  it("restricts a consumed key by requirement", () => {
    const optional = filterCatalog(entries, {
      consumes: { key: "account", requirement: "optional" },
    });
    expect(optional.map(e => e.expression)).toEqual([
      "the account might exist",
    ]);
    const required = filterCatalog(entries, {
      consumes: { key: "account", requirement: "required" },
    });
    expect(required).toEqual([]);
  });

  it("filters by produced key", () => {
    const result = filterCatalog(entries, { produces: "user" });
    expect(result.map(e => e.expression)).toEqual([
      "a user",
      "I save the user",
    ]);
  });

  it("ANDs multiple query fields together", () => {
    const result = filterCatalog(entries, {
      stepType: "when",
      consumes: { key: "user", phase: "given" },
      produces: "user",
    });
    expect(result.map(e => e.expression)).toEqual(["I save the user"]);
  });
});
