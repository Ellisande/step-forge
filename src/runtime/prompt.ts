import * as readline from "node:readline";

/**
 * A hand-rolled, dependency-free typeahead prompt for interactive mode. It owns
 * the terminal's raw-mode input and renders a block pinned to the bottom of the
 * screen: a scrollable list of suggestions above a `> query` input line. Run
 * output is meant to scroll *above* this block — {@link Prompt.printAbove} erases
 * the block, lets a caller write, then redraws it lower down.
 *
 * The prompt is pure view + input: it filters/ranks {@link Suggestion}s by the
 * typed query and reports intent through callbacks ({@link PromptHandlers}), but
 * holds no run/watch logic. The orchestrator wires those callbacks.
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
  /** Max suggestion rows shown at once. Default `10`. */
  maxVisible?: number;
  /** Initial query text. */
  initialQuery?: string;
}

// --- ANSI ------------------------------------------------------------------
const useColor =
  !process.env.NO_COLOR && (process.stdout.isTTY ?? false) === true;
const wrap = (open: number, close: number) => (s: string) =>
  useColor ? `\x1b[${open}m${s}\x1b[${close}m` : s;
const color = {
  green: wrap(32, 39),
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

  /** Optional dim status line shown just above the input (set by the caller). */
  status = "";

  /** Lines the pinned block currently occupies, so a redraw can erase them. */
  private rendered = 0;
  private started = false;
  /** While true the block is hidden so a run's output can own the screen. */
  private suspended = false;
  private keyListener?: (str: string, key: readline.Key) => void;

  constructor(options: PromptOptions) {
    this.handlers = options.handlers;
    this.prefix = options.prefix ?? "› ";
    this.maxVisible = options.maxVisible ?? 10;
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

  /** Enter raw mode, attach the keypress listener, and draw the block. */
  start(): void {
    if (this.started) return;
    this.started = true;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this.keyListener = (str, key) => this.onKey(str, key ?? {});
    process.stdin.on("keypress", this.keyListener);
    process.stdin.resume();
    this.render();
  }

  /** Erase the block, restore cooked mode, and detach the listener. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.erase();
    write("\x1b[?25h"); // ensure the cursor is visible again
    if (this.keyListener) process.stdin.off("keypress", this.keyListener);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  /**
   * Erase the pinned block and hide it for the duration of an (async) run, so
   * everything written to stdout in the meantime scrolls where the prompt was.
   * Keypresses still update state but don't repaint until {@link endOutput}.
   */
  beginOutput(): void {
    if (!this.started) return;
    this.erase();
    this.suspended = true;
  }

  /** Redraw the pinned block below whatever output {@link beginOutput} let through. */
  endOutput(): void {
    if (!this.started) return;
    this.suspended = false;
    this.render();
  }

  /** Force a redraw (after mutating `status`, say). No-op while suspended. */
  redraw(): void {
    if (this.started && !this.suspended) this.render();
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
  /** Build the block's lines, top (suggestions) to bottom (input). */
  private buildLines(): string[] {
    const lines: string[] = [];
    const total = this.matches.length;

    if (this.query.trim() && total === 0) {
      lines.push(color.dim("  no matching tag, feature, or scenario"));
    }

    const end = Math.min(this.window + this.maxVisible, total);
    for (let i = this.window; i < end; i++) {
      const s = this.matches[i];
      const active = i === this.selected;
      const badge = color.cyan(s.badge.padEnd(9));
      const row = `${badge} ${s.label}`;
      lines.push(active ? color.inverse(`❯ ${row}`) : `  ${row}`);
    }
    if (total > end) {
      lines.push(color.dim(`  …and ${total - end} more`));
    }

    if (this.status) lines.push(color.dim(this.status));
    lines.push(`${color.bold(this.prefix)}${this.query}`);
    return lines;
  }

  private render(): void {
    if (this.suspended) return; // a run owns the screen; don't repaint over it
    write("\x1b[?25l"); // hide caret while we repaint
    this.moveToBlockStart();
    write("\x1b[0J"); // clear from here to end of screen
    const lines = this.buildLines();
    write(lines.join("\r\n"));
    this.rendered = lines.length;
    // Park the caret on the input line at the right column.
    write(`\r\x1b[${stringWidth(this.prefix) + this.cursor}C`);
    write("\x1b[?25h");
  }

  /** Erase the block and leave the caret at the block's top-left. */
  private erase(): void {
    this.moveToBlockStart();
    write("\x1b[0J");
    this.rendered = 0;
  }

  /** Move the caret to column 0 of the block's first line. */
  private moveToBlockStart(): void {
    if (this.rendered > 1) write(`\x1b[${this.rendered - 1}A`);
    write("\r");
  }
}

/** Visible width, ignoring the ANSI escapes our color helpers may inject. */
function stringWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function write(s: string): void {
  process.stdout.write(s);
}
