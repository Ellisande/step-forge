import { afterEach, beforeEach, expect, test } from "bun:test";
import { hyperlink } from "./hyperlink";
import { clip, stringWidth } from "./prompt";

// `hyperlink`'s enable/scheme decision reads env at call time, so each test sets
// the env it needs and we restore afterwards.
const saved = { ...process.env };
beforeEach(() => {
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  delete process.env.TERM_PROGRAM;
  delete process.env.__CFBundleIdentifier;
  delete process.env.STEP_FORGE_EDITOR;
});
afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, saved);
});

const ESC = "\x1b";
const BEL = "\x07";

test("NO_COLOR disables hyperlinks — text passes through unchanged", () => {
  process.env.FORCE_COLOR = "1";
  process.env.NO_COLOR = "1";
  expect(hyperlink("foo.ts:1", "/abs/foo.ts", 1, 2)).toBe("foo.ts:1");
});

test("VS Code terminal emits a vscode://file link at line:col", () => {
  process.env.FORCE_COLOR = "1";
  process.env.TERM_PROGRAM = "vscode";
  const out = hyperlink("foo.ts:1:2", "/abs/foo.ts", 1, 2);
  expect(out).toBe(
    `${ESC}]8;;vscode://file/abs/foo.ts:1:2${BEL}foo.ts:1:2${ESC}]8;;${BEL}`
  );
});

test("STEP_FORGE_EDITOR overrides detection (cursor scheme)", () => {
  process.env.FORCE_COLOR = "1";
  process.env.TERM_PROGRAM = "vscode"; // would otherwise be vscode
  process.env.STEP_FORGE_EDITOR = "cursor";
  expect(hyperlink("f", "/abs/f.ts", 3)).toContain("cursor://file/abs/f.ts:3");
});

test("STEP_FORGE_EDITOR=file forces a plain file:// link", () => {
  process.env.FORCE_COLOR = "1";
  process.env.TERM_PROGRAM = "vscode"; // would otherwise be vscode
  process.env.STEP_FORGE_EDITOR = "file";
  expect(hyperlink("f", "/abs/f.ts", 3)).toContain("file:///abs/f.ts");
});

test("unknown terminal falls back to a percent-encoded file:// URL", () => {
  process.env.FORCE_COLOR = "1";
  const out = hyperlink("f", "/abs/my file.ts", 1);
  expect(out).toContain("file:///abs/my%20file.ts");
});

test("clip() treats an OSC 8 link as zero width and keeps it intact", () => {
  process.env.FORCE_COLOR = "1";
  process.env.TERM_PROGRAM = "vscode";
  const link = hyperlink("foo.ts:1", "/abs/foo.ts", 1); // visible width 8
  // 40 columns easily fits the 8 visible chars: the whole link survives.
  expect(clip(link, 40)).toBe(link);
  expect(stringWidth(link)).toBe(8);
});

test("clip() closes an open hyperlink when it cuts through the link text", () => {
  process.env.FORCE_COLOR = "1";
  process.env.TERM_PROGRAM = "vscode";
  const link = hyperlink("abcdefgh", "/abs/foo.ts", 1);
  const cut = clip(link, 3);
  expect(cut).toContain("abc");
  expect(cut).not.toContain("defgh"); // clipped off
  expect(cut).toContain(`${ESC}]8;;${BEL}`); // link explicitly closed at the cut
});
