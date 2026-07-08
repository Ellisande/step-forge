import { pathToFileURL } from "node:url";

/**
 * OSC 8 terminal hyperlinks for file locations.
 *
 * The full-screen interactive TUI runs in the terminal's *alternate screen
 * buffer* with mouse reporting enabled. In that mode a terminal's own path
 * detection — the heuristic that makes a bare `foo.ts:12` ⌘-clickable in plain
 * scrollback — no longer fires: the app owns the screen and the mouse, so plain
 * clicks are routed to us as escape sequences, not to the terminal's link
 * handler. The fix is to stop relying on that heuristic and emit an **explicit**
 * OSC 8 hyperlink, which terminals honor inside the alt buffer and under mouse
 * reporting.
 *
 * Enabled under the same condition the reporter colors output: a real TTY, or a
 * child runner told to keep color via `FORCE_COLOR` (interactive mode spawns
 * `step-forge --events` down a pipe and renders its blocks itself, so the child
 * must still emit the links). Disabled under `NO_COLOR`. Read per call rather
 * than cached so the environment is always honored as it stands.
 */
function useHyperlinks(): boolean {
  return (
    !process.env.NO_COLOR &&
    (!!process.env.FORCE_COLOR || (process.stdout.isTTY ?? false) === true)
  );
}

const OSC8 = "\x1b]8;;";
const ST = "\x07"; // BEL, the widely-supported OSC string terminator

/**
 * Wrap `text` in an OSC 8 hyperlink pointing at `file` (optionally at
 * `line`/`column`). Returns `text` unchanged when hyperlinks are disabled, so
 * callers can wrap unconditionally.
 */
export function hyperlink(
  text: string,
  file: string,
  line?: number,
  column?: number
): string {
  if (!useHyperlinks()) return text;
  const url = editorUrl(file, line, column);
  return `${OSC8}${url}${ST}${text}${OSC8}${ST}`;
}

/**
 * The URL a location should open. Editor URL schemes
 * (`vscode://file/<abs path>:<line>:<col>`, and the identical `cursor`/
 * `windsurf` forks) jump to the exact line; a plain `file://` URL opens the
 * file everywhere OSC 8 is supported (iTerm2, Ghostty, WezTerm, kitty…) but
 * without a guaranteed line, so it's the fallback when the editor is unknown.
 */
function editorUrl(file: string, line?: number, column?: number): string {
  const scheme = editorScheme();
  if (scheme === "file") return pathToFileURL(file).href;
  const pos = line ? `:${line}${column ? `:${column}` : ""}` : "";
  return `${scheme}://file${encodeURI(file)}${pos}`;
}

/**
 * Which editor to target. An explicit `STEP_FORGE_EDITOR` wins (`vscode` |
 * `cursor` | `windsurf` | `file`); otherwise a VS Code-family integrated
 * terminal (`TERM_PROGRAM=vscode`) gets the documented `vscode://` deep link,
 * and everything else falls back to a plain `file://` link.
 *
 * The VS Code forks (Cursor, Windsurf) all report `TERM_PROGRAM=vscode` and
 * can't be told apart reliably from the environment, so they get `vscode://` by
 * default; a user on one whose links don't jump can set
 * `STEP_FORGE_EDITOR=cursor` (or `windsurf`, or `file`).
 */
function editorScheme(): "vscode" | "cursor" | "windsurf" | "file" {
  const override = process.env.STEP_FORGE_EDITOR?.trim().toLowerCase();
  if (
    override === "vscode" ||
    override === "cursor" ||
    override === "windsurf" ||
    override === "file"
  ) {
    return override;
  }
  return process.env.TERM_PROGRAM === "vscode" ? "vscode" : "file";
}
