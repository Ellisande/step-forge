import { describe, expect, test } from "bun:test";
import { normalizeTags, resolveConfig, RunnerOptions } from "./config";

const CWD = "/repo";

describe("normalizeTags", () => {
  test("passes a string expression through unchanged", () => {
    expect(normalizeTags("@smoke and not @wip")).toBe("@smoke and not @wip");
  });

  test("OR-joins a list of tags", () => {
    expect(normalizeTags(["@smoke", "@fast"])).toBe("(@smoke or @fast)");
  });

  test("a single-element list is just that tag", () => {
    expect(normalizeTags(["@smoke"])).toBe("@smoke");
  });

  test("an empty or all-blank list is undefined", () => {
    expect(normalizeTags([])).toBeUndefined();
    expect(normalizeTags(["  "])).toBeUndefined();
  });

  test("undefined stays undefined", () => {
    expect(normalizeTags(undefined)).toBeUndefined();
  });
});

describe("resolveConfig profiles", () => {
  const file: RunnerOptions = {
    features: ["features/**/*.feature"],
    steps: ["steps/**/*.ts"],
    concurrency: 1,
    profiles: {
      smoke: { tags: ["@smoke", "@fast"], reporter: "progress" },
      ci: { tags: "@ci and not @wip", concurrency: 4, verbose: true },
    },
  };

  test("selecting a profile layers its options over the base config", () => {
    const resolved = resolveConfig(CWD, file, {}, "smoke");
    expect(resolved.tags).toBe("(@smoke or @fast)");
    expect(resolved.reporter).toBe("progress");
    // Inherited from the base config.
    expect(resolved.steps).toEqual(["steps/**/*.ts"]);
    expect(resolved.features).toEqual(["features/**/*.feature"]);
  });

  test("a profile can override scalar settings like concurrency", () => {
    const resolved = resolveConfig(CWD, file, {}, "ci");
    expect(resolved.tags).toBe("@ci and not @wip");
    expect(resolved.concurrency).toBe(4);
    expect(resolved.verbose).toBe(true);
  });

  test("CLI overrides win over the profile", () => {
    const resolved = resolveConfig(CWD, file, { tags: "@only-this" }, "smoke");
    expect(resolved.tags).toBe("@only-this");
    // Non-overridden profile fields still apply.
    expect(resolved.reporter).toBe("progress");
  });

  test("no profile selected leaves the base config untouched", () => {
    const resolved = resolveConfig(CWD, file, {});
    expect(resolved.tags).toBeUndefined();
    expect(resolved.reporter).toBe("pretty");
  });

  test("an unknown profile name throws with the known names listed", () => {
    expect(() => resolveConfig(CWD, file, {}, "nope")).toThrow(
      /Unknown profile "nope".*"smoke".*"ci"/
    );
  });

  test("resolved config exposes every profile's selection for the picker", () => {
    const resolved = resolveConfig(CWD, file, {});
    expect(resolved.profiles).toEqual([
      { id: "smoke", tags: "(@smoke or @fast)", name: undefined },
      { id: "ci", tags: "@ci and not @wip", name: undefined },
    ]);
  });

  test("a profile inherits the base tags/name when it sets neither", () => {
    const withBase: RunnerOptions = {
      tags: "@base",
      name: "login",
      profiles: { plain: { reporter: "progress" } },
    };
    const resolved = resolveConfig(CWD, withBase, {});
    expect(resolved.profiles).toEqual([
      { id: "plain", tags: "@base", name: "login" },
    ]);
  });
});
