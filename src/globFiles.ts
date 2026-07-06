import { glob } from "node:fs/promises";
import { stat } from "node:fs/promises";
import * as path from "node:path";

/** Glob metacharacters. A pattern with none of these is a literal path. */
const MAGIC = /[*?[\]{}!()]/;

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve glob patterns to a de-duplicated list of absolute file paths, with one
 * important portability guarantee: a **literal absolute path** (no glob magic)
 * is returned directly if it exists, without being handed to `glob()`.
 *
 * This exists because `node:fs`'s `glob` diverges between runtimes — Node
 * matches an absolute-path pattern, Bun returns nothing for one. Rather than
 * depend on that behaviour, we only ever glob relative patterns (against `cwd`)
 * and short-circuit concrete absolute paths ourselves, so callers get identical
 * results under Node and Bun.
 */
export async function globFiles(
  patterns: string[],
  cwd: string = process.cwd()
): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    if (path.isAbsolute(pattern) && !MAGIC.test(pattern)) {
      if (await isFile(pattern)) files.add(pattern);
      continue;
    }
    for await (const match of glob(pattern, { cwd })) {
      files.add(path.resolve(cwd, match));
    }
  }
  return [...files];
}
