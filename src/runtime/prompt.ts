import * as readline from "node:readline";
import { PassThrough } from "node:stream";

/**
 * A hand-rolled, dependency-free full-screen TUI for interactive mode. It owns
 * the terminal's raw-mode input and the **alternate screen buffer**, and paints
 * three stacked regions top-to-bottom:
 *
 *   1. prompt  — the `› query` input line plus a status hint
 *   2. selection — the scrollable typeahead list of suggestions
 *   3. results — the current run, itself ordered stats → dots → failures
 *
 * The prompt/selection are pure view + input: they filter/rank {@link Suggestion}s
 * by the typed query and report intent through callbacks ({@link PromptHandlers}).
 * The results region is a small model the orchestrator drives as a run streams
 * ({@link Prompt.resetResults} / {@link Prompt.scenario} / {@link Prompt.complete}),
 * so stats can sit *above* the dots and the failures pane can scroll on its own.
 */
export interface Suggestion {
  /** Human label shown after the badge, e.g. a scenario name. */
  label: string;
  /** Short kind marker shown before the label, e.g. `#tag` / `feature`. */
  badge: string;
  /** Text the query is matched against (case-insensitively). */
  search: string;
  /** Opaque payload handed back to {@link PromptHandlers.onSubmit}. */
  value: unknown;
}

export interface PromptHandlers {
  /** Enter: `value` is the highlighted suggestion, or `null` when none matches. */
  onSubmit(value: unknown | null, query: string): void;
  /** The query text changed (insert/delete) — used to suspend auto-runs. */
  onEdit(query: string): void;
  /** Escape pressed. */
  onEscape(): void;
  /** Ctrl-C / Ctrl-D — the caller should tear down and exit. */
  onQuit(): void;
}

export interface PromptOptions {
  handlers: PromptHandlers;
  /** Input prefix. Default `"› "`. */
  prefix?: string;
  /** Max suggestion rows shown at once. Default `8`. */
  maxVisible?: number;
  /** Initial query text. */
  initialQuery?: string;
}

/** Header describing the run currently shown in the results region. */
export interface RunHeader {
  label: string;
  scenarioCount: number;
  runCount: number;
  clock: string;
}

interface Counts {
  passed: number;
  failed: number;
  skipped: number;
}

/** Mutable model of the run currently rendered in the results region. */
interface ResultsState {
  header?: RunHeader;
  running: boolean;
  durationMs?: number;
  scenarios: Counts;
  steps: Counts;
  /** One rendered dot char per finished scenario (`.`/`F`/`-`). */
  dots: string[];
  /** Rendered Cucumber failure blocks (each multi-line). */
  failures: string[];
  /** Extra lines above the dots: analyzer diagnostics, errors, empty notices. */
  notes: string[];
}

function freshResults(): ResultsState {
  return {
    running: false,
    scenarios: { passed: 0, failed: 0, skipped: 0 },
    steps: { passed: 0, failed: 0, skipped: 0 },
    dots: [],
    failures: [],
    notes: [],
  };
}

// --- ANSI ------------------------------------------------------------------
const useColor =
  !process.env.NO_COLOR && (process.stdout.isTTY ?? false) === true;
const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;
const color = {
  green: wrap(32, 39),
  red: wrap(31, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
  inverse: wrap(7, 27),
};

/** Ranked match: lower rank sorts first; `-1` means "no match" (excluded). */
function rank(search: string, query: string): number {
  if (!query) return 0;
  const idx = search.indexOf(query);
  if (idx === -1) return -1;
  if (idx === 0) return 0; // prefix
  // word-boundary (space, `:`, `›`, `@`) scores above a bare substring.
  return /[\s:›@/]/.test(search[idx - 1]) ? 1 : 2;
}

export class Prompt {
  private readonly handlers: PromptHandlers;
  private readonly prefix: string;
  private readonly maxVisible: number;

  private all: Suggestion[] = [];
  private matches: Suggestion[] = [];
  private query: string;
  private cursor: number; // caret index within `query`
  private selected = 0; // index into `matches`
  private window = 0; // first visible match index

  /** Optional dim status line shown just below the input (set by the caller). */
  status = "";

  private results = freshResults();
  private failScroll = 0; // top line offset of the failures pane

  private started = false;
  /** Filtered key stream: raw stdin minus the mouse sequences we handle. */
  private input?: PassThrough;
  private keyListener?: (str: string, key: readline.Key) => void;
  private dataListener?: (chunk: Buffer) => void;
  private resizeListener?: () => void;
  private signalCleanup?: () => void;
  /** Carry an incomplete mouse sequence split across stdin chunks. */
  private mousePending = "";

  constructor(options: PromptOptions) {
    this.handlers = options.handlers;
    this.prefix = options.prefix ?? "› ";
    this.maxVisible = options.maxVisible ?? 8;
    this.query = options.initialQuery ?? "";
    this.cursor = this.query.length;
  }

  /** Replace the suggestion pool (e.g. after the feature cache rebuilds). */
  setSuggestions(suggestions: Suggestion[]): void {
    this.all = suggestions;
    this.refilter();
    if (this.started) this.render();
  }

  get value(): string {
    return this.query;
  }

  // --- results model (driven by the orchestrator as a run streams) ---------
  /** Start a fresh run: reset counts/dots/failures and record its header. */
  resetResults(header: RunHeader): void {
    this.results = freshResults();
    this.results.header = header;
    this.results.running = true;
    this.failScroll = 0;
    this.render();
  }

  /** Append a note line above the dots (diagnostics, errors, empty notices). */
  note(line: string): void {
    this.results.notes.push(line);
    this.render();
  }

  /** Push a standalone block into the scrollable failures pane (e.g. a crash). */
  failureBlock(text: string): void {
    this.results.failures.push(text);
    this.render();
  }

  /** Record one finished scenario: tally it, add its dot, keep any failure block. */
  scenario(status: keyof Counts, steps: Counts, detail?: string): void {
    this.results.scenarios[status]++;
    this.results.steps.passed += steps.passed;
    this.results.steps.failed += steps.failed;
    this.results.steps.skipped += steps.skipped;
    this.results.dots.push(dotFor(status));
    if (detail) this.results.failures.push(detail);
    this.render();
  }

  /** Mark the run finished and record its wall-clock duration. */
  complete(durationMs: number): void {
    this.results.running = false;
    this.results.durationMs = durationMs;
    this.render();
  }

  // --- lifecycle -----------------------------------------------------------
  /** Enter the alternate screen + raw mode, attach listeners, and paint. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    // Alt screen + SGR mouse reporting. Mouse sequences are pulled out of the
    // raw stdin stream by `onStdinData` (only the wheel is acted on — it scrolls
    // the failures pane); everything else is forwarded to `input`, where
    // readline decodes it into keypresses. Splitting the stream is required
    // because readline would otherwise spill a mouse sequence's digits into the
    // query.
    write("\x1b[?1049h\x1b[?1000h\x1b[?1006h");
    this.input = new PassThrough();
    readline.emitKeypressEvents(this.input);
    this.keyListener = (str, key) => this.onKey(str, key ?? {});
    this.input.on("keypress", this.keyListener);
    this.dataListener = chunk => this.onStdinData(chunk);
    process.stdin.on("data", this.dataListener);
    process.stdin.resume();
    this.resizeListener = () => this.render();
    process.stdout.on("resize", this.resizeListener);
    this.installSafetyNet();
    this.render();
  }

  /** Restore the terminal: leave the alt buffer, cooked mode, cursor visible. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.dataListener) process.stdin.off("data", this.dataListener);
    if (this.keyListener) this.input?.off("keypress", this.keyListener);
    if (this.resizeListener) process.stdout.off("resize", this.resizeListener);
    this.signalCleanup?.();
    this.restoreTerminal();
    process.stdin.pause();
    this.input = undefined;
    this.mousePending = "";
  }

  /** Force a repaint (after mutating `status`, say). No-op until started. */
  redraw(): void {
    if (this.started) this.render();
  }

  /**
   * Leave raw mode and the alternate screen buffer and show the cursor.
   * Idempotent and synchronous so it is safe from an `exit`/signal handler —
   * a crash or `kill` must never strand the terminal in raw/alt-buffer mode.
   */
  private restoreTerminal(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    write("\x1b[?1006l\x1b[?1000l"); // stop mouse reporting
    write("\x1b[?25h"); // show cursor
    write("\x1b[?1049l"); // leave the alternate screen buffer
  }

  /**
   * Register process-level handlers so the terminal is always restored, even on
   * `kill` (SIGTERM), a crash (`exit` fires with a non-zero code), or a stray
   * SIGINT. In raw mode Ctrl-C arrives as a keypress (handled by `onKey`), not a
   * signal, so these are a safety net rather than the normal quit path.
   */
  private installSafetyNet(): void {
    const onExit = (): void => this.restoreTerminal();
    const onSignal = (): void => {
      this.restoreTerminal();
      process.exit(130);
    };
    process.on("exit", onExit);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    this.signalCleanup = () => {
      process.off("exit", onExit);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
  }

  // --- input ---------------------------------------------------------------
  private onKey(str: string, key: readline.Key): void {
    if (key.ctrl && (key.name === "c" || key.name === "d")) {
      this.handlers.onQuit();
      return;
    }
    switch (key.name) {
      case "return":
      case "enter": {
        const value = this.matches[this.selected]?.value ?? null;
        this.handlers.onSubmit(value, this.query);
        return;
      }
      case "escape":
        this.handlers.onEscape();
        return;
      case "up":
        this.move(-1);
        return;
      case "down":
        this.move(1);
        return;
      case "pageup":
        this.scrollFailures(-1);
        return;
      case "pagedown":
        this.scrollFailures(1);
        return;
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        this.render();
        return;
      case "right":
        this.cursor = Math.min(this.query.length, this.cursor + 1);
        this.render();
        return;
      case "home":
        this.cursor = 0;
        this.render();
        return;
      case "end":
        this.cursor = this.query.length;
        this.render();
        return;
      case "backspace":
        this.deleteBefore();
        return;
      case "delete":
        this.deleteAfter();
        return;
    }
    // Any single printable character (space included) is inserted.
    if (str && str.length === 1 && str >= " " && !key.ctrl && !key.meta) {
      this.insert(str);
    }
  }

  private insert(ch: string): void {
    this.query =
      this.query.slice(0, this.cursor) + ch + this.query.slice(this.cursor);
    this.cursor += ch.length;
    this.afterEdit();
  }

  private deleteBefore(): void {
    if (this.cursor === 0) return;
    this.query =
      this.query.slice(0, this.cursor - 1) + this.query.slice(this.cursor);
    this.cursor--;
    this.afterEdit();
  }

  private deleteAfter(): void {
    if (this.cursor >= this.query.length) return;
    this.query =
      this.query.slice(0, this.cursor) + this.query.slice(this.cursor + 1);
    this.afterEdit();
  }

  private afterEdit(): void {
    this.refilter();
    this.render();
    this.handlers.onEdit(this.query);
  }

  private move(delta: number): void {
    if (this.matches.length === 0) return;
    this.selected = Math.min(
      this.matches.length - 1,
      Math.max(0, this.selected + delta)
    );
    this.reWindow();
    this.render();
  }

  /** Scroll the failures pane by whole pages (PgUp/PgDn). */
  private scrollFailures(pages: number): void {
    this.adjustFailScroll(pages * this.failPage);
  }
  private failPage = 1; // last-rendered pane height, for page scrolling

  /** Move the failures viewport by `deltaLines` (clamped in {@link render}). */
  private adjustFailScroll(deltaLines: number): void {
    this.failScroll = Math.max(0, this.failScroll + deltaLines);
    this.render();
  }

  /**
   * Split a raw stdin chunk: decode SGR/legacy mouse sequences here (only the
   * wheel is acted on — it scrolls the failures pane by a few lines) and forward
   * everything else to readline. An incomplete trailing mouse sequence is held
   * in {@link mousePending} for the next chunk. `latin1` keeps every byte 1:1 so
   * the forwarded bytes reassemble exactly (including multibyte input).
   */
  private onStdinData(chunk: Buffer): void {
    const buf = this.mousePending + chunk.toString("latin1");
    let out = "";
    let i = 0;
    while (i < buf.length) {
      if (buf.startsWith("\x1b[<", i)) {
        // SGR mouse: ESC [ < b ; x ; y (M|m)
        const rel = /[Mm]/.exec(buf.slice(i + 3));
        if (!rel) break; // incomplete — carry to the next chunk
        const end = i + 3 + rel.index + 1;
        this.handleMouse(buf.slice(i, end));
        i = end;
        continue;
      }
      if (buf.startsWith("\x1b[M", i)) {
        // Legacy X10 mouse: ESC [ M then exactly three bytes.
        if (i + 6 > buf.length) break; // incomplete
        this.handleMouse(buf.slice(i, i + 6));
        i += 6;
        continue;
      }
      out += buf[i];
      i++;
    }
    this.mousePending = buf.slice(i);
    if (out) this.input?.write(Buffer.from(out, "latin1"));
  }

  /** Act on a decoded mouse sequence — wheel up/down scrolls failures; else ignore. */
  private handleMouse(seq: string): void {
    let button: number | null = null;
    // eslint-disable-next-line no-control-regex
    const sgr = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(seq);
    if (sgr) button = parseInt(sgr[1], 10);
    else if (seq.length === 6) button = seq.charCodeAt(3) - 32; // legacy X10
    if (button === null || (button & 0x40) === 0) return; // wheel events only
    this.adjustFailScroll((button & 1) === 0 ? -3 : 3); // up : down
  }

  private refilter(): void {
    const q = this.query.trim().toLowerCase();
    this.matches = this.all
      .map((s, index) => ({ s, index, r: rank(s.search, q) }))
      .filter(m => m.r !== -1)
      .sort((a, b) => a.r - b.r || a.index - b.index)
      .map(m => m.s);
    this.selected = 0;
    this.window = 0;
  }

  private reWindow(): void {
    if (this.selected < this.window) this.window = this.selected;
    else if (this.selected >= this.window + this.maxVisible)
      this.window = this.selected - this.maxVisible + 1;
  }

  // --- rendering -----------------------------------------------------------
  private rows(): number {
    return process.stdout.rows && process.stdout.rows > 0
      ? process.stdout.rows
      : 24;
  }
  private cols(): number {
    return process.stdout.columns && process.stdout.columns > 0
      ? process.stdout.columns
      : 80;
  }

  /** Prompt + selection lines. The input line is always row 0. */
  private topLines(): string[] {
    const lines: string[] = [];
    lines.push(`${color.bold(this.prefix)}${this.query}`);
    if (this.status) lines.push(color.dim(this.status));
    lines.push("");

    const total = this.matches.length;
    if (this.query.trim() && total === 0) {
      lines.push(color.dim("  no matching tag, feature, or scenario"));
    }
    const end = Math.min(this.window + this.maxVisible, total);
    for (let i = this.window; i < end; i++) {
      const s = this.matches[i];
      const active = i === this.selected;
      const row = `${color.cyan(s.badge.padEnd(9))} ${s.label}`;
      lines.push(active ? color.inverse(`❯ ${row}`) : `  ${row}`);
    }
    if (total > end) lines.push(color.dim(`  …and ${total - end} more`));
    return lines;
  }

  /** Stats (header + summary) and the wrapped dots, above the failures pane. */
  private resultLines(cols: number): string[] {
    const lines: string[] = ["", divider("results", cols)];
    const r = this.results;
    if (!r.header) {
      lines.push(
        color.dim("  no run yet — press enter to run the highlighted selection")
      );
      return lines;
    }

    // --- stats (top): header, live tallies, duration -----------------------
    const done = r.scenarios.passed + r.scenarios.failed + r.scenarios.skipped;
    lines.push(
      `  ${color.bold(`▶ ${r.header.label}`)} ${color.dim(
        `(run #${r.header.runCount} · ${r.header.clock})`
      )}`
    );
    const scenarioTotal = r.running
      ? `${done}/${r.header.scenarioCount}`
      : done;
    lines.push(
      `  ${countLine(String(scenarioTotal), "scenario", r.scenarios)}`
    );
    const stepTotal = r.steps.passed + r.steps.failed + r.steps.skipped;
    lines.push(`  ${countLine(String(stepTotal), "step", r.steps)}`);
    lines.push(
      r.running
        ? color.dim("  running…")
        : color.dim(`  ${((r.durationMs ?? 0) / 1000).toFixed(2)}s`)
    );

    for (const n of r.notes) lines.push(n);

    // --- dots (middle): the live heartbeat, wrapped, tail-capped -----------
    if (r.dots.length) {
      lines.push("");
      const per = Math.max(1, cols - 2);
      const dotRows: string[] = [];
      for (let i = 0; i < r.dots.length; i += per) {
        dotRows.push(`  ${r.dots.slice(i, i + per).join("")}`);
      }
      const maxDotRows = 6;
      if (dotRows.length > maxDotRows) {
        const hidden = dotRows.length - maxDotRows;
        lines.push(
          color.dim(`  …${hidden} earlier row${hidden === 1 ? "" : "s"}`)
        );
        lines.push(...dotRows.slice(-maxDotRows));
      } else {
        lines.push(...dotRows);
      }
    }
    return lines;
  }

  private render(): void {
    if (!this.started) return;
    const cols = this.cols();
    const rows = this.rows();

    const top = this.topLines();
    const caretCol = Math.min(stringWidth(this.prefix) + this.cursor + 1, cols);

    const above = [...top, ...this.resultLines(cols)];

    // The failures pane fills the rest of the screen and scrolls on its own.
    const failLines = flattenFailures(this.results.failures);
    const lines = [...above];
    if (failLines.length) {
      lines.push(
        "",
        divider(`failures (${this.results.failures.length})`, cols)
      );
      // Reserve one row for the scroll indicator.
      const pane = Math.max(1, rows - lines.length - 1);
      this.failPage = pane;
      const maxScroll = Math.max(0, failLines.length - pane);
      const off = Math.min(this.failScroll, maxScroll);
      this.failScroll = off;
      lines.push(...failLines.slice(off, off + pane));
      if (maxScroll > 0) {
        lines.push(
          color.dim(
            `  [${off + 1}-${off + Math.min(pane, failLines.length - off)}/${failLines.length}] · PgUp/PgDn to scroll`
          )
        );
      }
    }

    // Repaint: home, write each clipped line clearing to EOL, wipe below.
    write("\x1b[?25l\x1b[H");
    const visible = lines.slice(0, rows).map(l => `${clip(l, cols)}\x1b[K`);
    write(visible.join("\r\n"));
    write("\x1b[J"); // clear anything left below our content
    // Park the caret on the input line at the right column.
    write(`\x1b[1;${Math.max(1, caretCol)}H`);
    write("\x1b[?25h");
  }
}

/** A green `.` / red `F` / yellow `-` for a finished scenario. */
function dotFor(status: keyof Counts): string {
  if (status === "failed") return color.red("F");
  if (status === "skipped") return color.yellow("-");
  return color.green(".");
}

/** `<total> <noun>s (X passed, Y failed, Z skipped)`, zero parts omitted. */
function countLine(total: string, noun: string, counts: Counts): string {
  const part = (n: number, label: string, paint: (s: string) => string) =>
    n > 0 ? paint(`${n} ${label}`) : null;
  const parts = [
    part(counts.passed, "passed", color.green),
    part(counts.failed, "failed", color.red),
    part(counts.skipped, "skipped", color.yellow),
  ].filter((x): x is string => x !== null);
  const plural = total === "1" ? "" : "s";
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return `${total} ${noun}${plural}${detail}`;
}

/** Flatten failure blocks into lines, a blank line between blocks. */
function flattenFailures(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) out.push("");
    out.push(...block.split("\n"));
  });
  return out;
}

/** A dim `── label ─────` rule spanning the given width. */
function divider(label: string, cols: number): string {
  const head = `── ${label} `;
  const fill = Math.max(0, cols - head.length);
  return color.dim(head + "─".repeat(fill));
}

/** Visible width, ignoring the ANSI escapes our color helpers may inject. */
function stringWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Truncate `s` to `max` visible columns, preserving ANSI color escapes (which
 * have zero width) and re-resetting at the cut so a clipped color can't bleed.
 */
function clip(s: string, max: number): string {
  let width = 0;
  let out = "";
  // eslint-disable-next-line no-control-regex
  const escape = /^\x1b\[[0-9;]*m/;
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const m = escape.exec(rest);
    if (m) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    if (width >= max) return `${out}\x1b[0m`;
    out += s[i];
    width++;
    i++;
  }
  return out;
}

function write(s: string): void {
  process.stdout.write(s);
}
