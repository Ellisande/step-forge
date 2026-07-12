import { test, expect } from "bun:test";
import {
  userFrames,
  relativeLocation,
  captureDefinitionSite,
} from "./sourceLocation";

// A synthetic stack mixing user code, a node_modules assertion lib, an internal
// (relative — non-absolute) frame, and a node builtin. Only the user frames
// should survive trimming, nearest-first.
const STACK = [
  "Error: boom",
  "    at assert (/proj/node_modules/earl/dist/index.js:10:5)",
  "    at Object.<anonymous> (/proj/features/steps/user.steps.ts:12:15)",
  "    at Then (/proj/features/steps/user.steps.ts:8:3)",
  "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
].join("\n");

test("userFrames keeps only user code, nearest-first", () => {
  const frames = userFrames(STACK);
  expect(frames.map(f => `${f.file}:${f.line}:${f.column}`)).toEqual([
    "/proj/features/steps/user.steps.ts:12:15",
    "/proj/features/steps/user.steps.ts:8:3",
  ]);
});

test("userFrames drops node_modules, node: internals, and non-frames", () => {
  const joined = userFrames(STACK)
    .map(f => f.file)
    .join(",");
  expect(joined.includes("node_modules")).toEqual(false);
  expect(joined.includes("node:")).toEqual(false);
});

test("userFrames tolerates a bare (parenless) frame", () => {
  const frames = userFrames("    at /proj/steps/a.ts:3:9");
  expect(frames).toEqual([{ file: "/proj/steps/a.ts", line: 3, column: 9 }]);
});

test("relativeLocation makes an absolute location cwd-relative", () => {
  expect(relativeLocation("/proj/features/steps/a.ts:5:2", "/proj")).toEqual(
    "features/steps/a.ts:5:2"
  );
});

test("captureDefinitionSite returns undefined when no user frame is visible", () => {
  // This test file lives under the library root, so from here every frame is
  // "internal" — capture should find nothing rather than misattribute.
  expect(captureDefinitionSite()).toBeUndefined();
});
