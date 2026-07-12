import * as fs from "node:fs";
import * as path from "node:path";

/** Glob metacharacters — the same set {@link globFiles} treats as "magic". */
const MAGIC = /[*?[\]{}!()]/;

/** File extensions worth reacting to: features and step/world modules. */
const WATCHED_EXT = /\.(feature|ts|mts|js|mjs|cts|cjs)$/;

export interface Watcher {
  /** Stop watching and release every underlying `fs.watch` handle. */
  close(): void;
}

/**
 * Watch the directories implied by feature/step globs and invoke `onChange`
 * (debounced, coalesced) whenever a relevant file changes. Roots are the literal
 * directory prefixes of each glob — e.g. `features/**\/*.feature` watches
 * `features/` recursively — deduped so nested roots aren't watched twice.
 *
 * Recursive watching is supported on macOS and Windows and on modern Linux
 * (Node ≥ 20 / Bun); on older Linux only the top level of each root is seen.
 */
export function watchFeatures(
  globs: string[],
  cwd: string,
  onChange: () => void,
  debounceMs = 120
): Watcher {
  const roots = watchRoots(globs, cwd);
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (filename: string | null) => {
    // `fs.watch` may report a null filename; when we do get one, ignore churn
    // from unrelated files (editor swap files, `.git`, build output).
    if (filename && !WATCHED_EXT.test(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  for (const root of roots) {
    try {
      const w = fs.watch(root, { recursive: true }, (_event, filename) =>
        schedule(filename)
      );
      w.on("error", () => {}); // a removed/renamed root shouldn't crash the loop
      watchers.push(w);
    } catch {
      // Root doesn't exist yet (or can't be watched) — skip it silently.
    }
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

/**
 * The set of directories to watch: each glob's literal prefix (the path up to
 * its first magic character), resolved against `cwd`, deduped, with any root
 * that nests inside another dropped. Falls back to `cwd` when nothing resolves.
 */
export function watchRoots(globs: string[], cwd: string): string[] {
  const dirs = new Set<string>();
  for (const glob of globs) {
    dirs.add(path.resolve(cwd, literalPrefix(glob)));
  }
  const roots = [...dirs].sort();
  // Drop any root contained in an earlier (shorter) one, so recursive watches
  // don't overlap.
  const pruned = roots.filter(
    (r, i) => !roots.some((other, j) => j < i && isInside(r, other))
  );
  return pruned.length ? pruned : [cwd];
}

/** The directory portion of a glob before its first magic segment. */
function literalPrefix(glob: string): string {
  const segments = glob.split("/");
  const literal: string[] = [];
  for (const seg of segments) {
    if (MAGIC.test(seg)) break;
    literal.push(seg);
  }
  const joined = literal.join("/");
  // A bare `*.feature` has no literal prefix → watch cwd (".").
  if (!joined) return ".";
  // If the whole pattern was literal it points at a file; watch its directory.
  return MAGIC.test(glob) ? joined : path.dirname(joined);
}

/** True when `child` is `parent` itself or nested beneath it. */
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
