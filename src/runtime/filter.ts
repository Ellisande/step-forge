import { ParsedScenario } from "../analyzer/types";

/**
 * A predicate over a scenario's tags, compiled from a Cucumber tag expression.
 * Supports `and`, `or`, `not`, parentheses, and bare `@tag` atoms — the common
 * subset of Cucumber's tag-expression language. Kept dependency-free; swap for
 * `@cucumber/tag-expressions` if fuller parity is needed.
 */
export type TagPredicate = (tags: readonly string[]) => boolean;

/** Tokenise a tag expression into atoms, operators, and parentheses. */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(\(|\)|@[^\s()]+|\band\b|\bor\b|\bnot\b)\s*/gy;
  let index = 0;
  while (index < expr.length) {
    re.lastIndex = index;
    const m = re.exec(expr);
    if (!m || m.index !== index) {
      throw new Error(`Invalid tag expression near: ${expr.slice(index)}`);
    }
    tokens.push(m[1]);
    index = re.lastIndex;
  }
  return tokens;
}

/**
 * Compile a tag expression into a predicate via recursive descent
 * (or → and → not → primary). Throws on malformed input so a bad `--tags` flag
 * fails loudly rather than silently matching nothing.
 */
export function compileTagExpression(expr: string): TagPredicate {
  const tokens = tokenize(expr);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const parseOr = (): TagPredicate => {
    let left = parseAnd();
    while (peek() === "or") {
      next();
      const right = parseAnd();
      const l = left;
      left = tags => l(tags) || right(tags);
    }
    return left;
  };

  const parseAnd = (): TagPredicate => {
    let left = parseNot();
    while (peek() === "and") {
      next();
      const right = parseNot();
      const l = left;
      left = tags => l(tags) && right(tags);
    }
    return left;
  };

  const parseNot = (): TagPredicate => {
    if (peek() === "not") {
      next();
      const operand = parseNot();
      return tags => !operand(tags);
    }
    return parsePrimary();
  };

  const parsePrimary = (): TagPredicate => {
    const token = next();
    if (token === "(") {
      const inner = parseOr();
      if (next() !== ")") throw new Error("Unbalanced parentheses in tags");
      return inner;
    }
    if (token === undefined || !token.startsWith("@")) {
      throw new Error(`Expected a tag, got: ${token ?? "end of input"}`);
    }
    return tags => tags.includes(token);
  };

  const predicate = parseOr();
  if (pos !== tokens.length) {
    throw new Error(`Unexpected token in tag expression: ${peek()}`);
  }
  return predicate;
}

export interface SelectOptions {
  /** Substring or `/regex/flags` match against the scenario (or outline) name. */
  name?: string;
  /** Cucumber tag expression. */
  tags?: string;
}

/** Parse a `/pattern/flags` string into a RegExp, else treat it as a substring. */
function toNameMatcher(name: string): (candidate: string) => boolean {
  const delim = /^\/(.*)\/([a-z]*)$/.exec(name);
  if (delim) {
    const re = new RegExp(delim[1], delim[2]);
    return candidate => re.test(candidate);
  }
  return candidate => candidate.includes(name);
}

/**
 * Narrow scenarios by name and tags, then apply `@only` focus. `@skip` is *not*
 * applied here — skipped scenarios stay in the set so the runner can report them
 * as skipped rather than silently dropping them. Returns scenarios in input
 * order.
 *
 * `@only` semantics mirror the Vitest plugin: if any surviving scenario is
 * tagged `@only` (and not `@skip`), the run is focused to just those.
 */
export function selectScenarios(
  scenarios: ParsedScenario[],
  options: SelectOptions
): ParsedScenario[] {
  let selected = scenarios;

  if (options.name) {
    const matches = toNameMatcher(options.name);
    selected = selected.filter(
      s => matches(s.name) || (s.outline ? matches(s.outline.name) : false)
    );
  }

  if (options.tags) {
    const predicate = compileTagExpression(options.tags);
    selected = selected.filter(s => predicate(s.tags));
  }

  const focused = selected.filter(
    s => s.tags.includes("@only") && !s.tags.includes("@skip")
  );
  return focused.length ? focused : selected;
}
