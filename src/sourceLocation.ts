import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Directory holding the library's own compiled code. In development this is the
 * `src/` tree; in the published package it's `dist/` (this module is bundled
 * into the shipped chunks). Stack frames under it are internal plumbing —
 * builders, the engine, the runner — and are hidden from users so that a
 * failure points at *their* step, not ours.
 */
const LIB_ROOT = path.dirname(fileURLToPath(import.meta.url));

export interface SourceFrame {
  file: string;
  line: number;
  column: number;
}

/**
 * A frame belongs to user code if it's an absolute path that is neither inside
 * the library nor inside any `node_modules` (assertion libs, etc.). That leaves
 * exactly the frames a user cares about: their own step definitions.
 */
function isUserFile(file: string): boolean {
  return (
    path.isAbsolute(file) &&
    !file.startsWith(LIB_ROOT + path.sep) &&
    !file.includes(`${path.sep}node_modules${path.sep}`)
  );
}

/** Parse one `Error.stack` line into a frame, tolerating V8/Bun variations. */
function parseFrame(frameLine: string): SourceFrame | undefined {
  const m = /:(\d+):(\d+)\)?\s*$/.exec(frameLine);
  if (!m) return undefined;
  let file = frameLine.slice(0, m.index);
  const paren = file.lastIndexOf("(");
  if (paren !== -1) file = file.slice(paren + 1);
  file = file.trim().replace(/^at\s+/, "");
  if (file.startsWith("file://")) {
    try {
      file = fileURLToPath(file);
    } catch {
      return undefined;
    }
  }
  return { file, line: Number(m[1]), column: Number(m[2]) };
}

/** Every user-code frame in a stack, nearest-first, internals removed. */
export function userFrames(stack: string | undefined): SourceFrame[] {
  if (!stack) return [];
  const frames: SourceFrame[] = [];
  for (const line of stack.split("\n")) {
    const frame = parseFrame(line);
    if (frame && isUserFile(frame.file)) frames.push(frame);
  }
  return frames;
}

/**
 * Capture the user source location of the current call site — the first
 * user-code frame above this function. Called from `.step()` registration so
 * each step remembers where it was defined (Cucumber-style), independent of
 * where an error is later thrown. Returns an absolute `file:line:column`, or
 * `undefined` if no user frame is visible.
 */
export function captureDefinitionSite(): string | undefined {
  const frame = userFrames(new Error().stack)[0];
  return frame ? `${frame.file}:${frame.line}:${frame.column}` : undefined;
}

/** Render an absolute `file:line:column` relative to `cwd` for display. */
export function relativeLocation(location: string, cwd: string): string {
  const m = /^(.*):(\d+):(\d+)$/.exec(location);
  if (!m) return location;
  return `${path.relative(cwd, m[1])}:${m[2]}:${m[3]}`;
}

/** Render a frame relative to `cwd`. */
export function relativeFrame(frame: SourceFrame, cwd: string): string {
  return `${path.relative(cwd, frame.file)}:${frame.line}:${frame.column}`;
}
