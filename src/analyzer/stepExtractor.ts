import ts from "typescript";
import {
  booleanParser,
  intParser,
  numberParser,
  stringParser,
} from "../parsers.js";
import { StepDefinitionMeta } from "./types.js";

type StepType = "given" | "when" | "then";

const BUILDER_NAMES: Record<string, StepType> = {
  givenBuilder: "given",
  whenBuilder: "when",
  thenBuilder: "then",
};

/**
 * Threaded through the AST walk. `checker` is `null` on the parse-only fast
 * path; a step that genuinely needs type information sets `needsChecker`, which
 * triggers a one-time retry with a real type-checked `Program`.
 */
interface ExtractCtx {
  checker: ts.TypeChecker | null;
  needsChecker: boolean;
}

export function extractStepDefinitions(
  filePaths: string[],
  tsConfigPath?: string
): StepDefinitionMeta[] {
  // Fast path: parse each file with `createSourceFile` (tokenize + parse only,
  // no type resolution — ~1ms/file) and walk the AST. Building a full
  // type-checked `Program` loads `lib.*.d.ts` and resolves every import (~150ms)
  // and is only needed for two uncommon shapes: a `.step()` whose return isn't a
  // plain object literal, or the re-exported-builder pattern. Those set
  // `needsChecker`, and we retry once with a real Program below.
  const sources = filePaths
    .map(parseSourceFile)
    .filter((s): s is ts.SourceFile => s !== null);
  const fast = extractWithSources(sources, null);
  if (!fast.needsChecker) return fast.results;

  // Slow path: some step needs type information. Build the program once and
  // re-extract from *its* source files — the checker only understands nodes it
  // bound itself, so the parse-only ASTs above can't be reused here.
  const program = ts.createProgram(
    filePaths,
    resolveCompilerOptions(tsConfigPath)
  );
  const checker = program.getTypeChecker();
  const checkedSources = filePaths
    .map(fp => program.getSourceFile(fp))
    .filter((s): s is ts.SourceFile => s !== undefined);
  return extractWithSources(checkedSources, checker).results;
}

/** Parse a single file into an AST with no type resolution. */
function parseSourceFile(filePath: string): ts.SourceFile | null {
  const text = ts.sys.readFile(filePath);
  if (text === undefined) return null;
  const scriptKind = filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  // setParentNodes: true — the extractor relies on `.getText()`/`.getStart()`,
  // which walk parent pointers up to the SourceFile.
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.ESNext,
    true,
    scriptKind
  );
}

/** Resolve compiler options from tsconfig (fallback to sane defaults). */
function resolveCompilerOptions(tsConfigPath?: string): ts.CompilerOptions {
  const configPath =
    tsConfigPath ?? ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    esModuleInterop: true,
  };

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.error) {
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        configPath.replace(/[/\\][^/\\]+$/, "")
      );
      compilerOptions = parsed.options;
    }
  }

  // Ensure noEmit so we don't write files
  compilerOptions.noEmit = true;
  return compilerOptions;
}

function extractWithSources(
  sources: ts.SourceFile[],
  checker: ts.TypeChecker | null
): { results: StepDefinitionMeta[]; needsChecker: boolean } {
  const ctx: ExtractCtx = { checker, needsChecker: false };
  const results: StepDefinitionMeta[] = [];
  for (const sourceFile of sources) {
    results.push(...extractFromSourceFile(sourceFile, ctx));
  }
  return { results, needsChecker: ctx.needsChecker };
}

function extractFromSourceFile(
  sourceFile: ts.SourceFile,
  ctx: ExtractCtx
): StepDefinitionMeta[] {
  const results: StepDefinitionMeta[] = [];

  function visit(node: ts.Node) {
    // The chain now terminates at `.step(...)`, which is the registration
    // point (there is no `.register()` anymore).
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "step"
    ) {
      const meta = extractFromRegisterCall(node, sourceFile, ctx);
      if (meta) {
        results.push(meta);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

function extractFromRegisterCall(
  registerCall: ts.CallExpression,
  sourceFile: ts.SourceFile,
  ctx: ExtractCtx
): StepDefinitionMeta | null {
  // Walk backwards through the method chain to find all parts
  // Pattern: builder().statement(...).dependencies?(...).step(...).register()
  // Or: Variable("...").dependencies?(...).step(...).register()

  const chain = collectCallChain(registerCall);

  let stepType: StepType | null = null;
  let statementCall: ts.CallExpression | null = null;
  let variablesCall: ts.CallExpression | null = null;
  let dependencies: StepDefinitionMeta["dependencies"] = {
    given: {},
    when: {},
    then: {},
  };
  let produces: string[] = [];

  for (const link of chain) {
    const name = getCallName(link);
    if (!name) continue;

    if (name === "register") {
      // Already at register, continue
      continue;
    }

    if (name === "step") {
      produces = extractProducedKeys(link, ctx);
      continue;
    }

    if (name === "dependencies") {
      dependencies = extractDependencies(link);
      continue;
    }

    if (name === "statement") {
      statementCall = link;
      // Try to find the builder type by continuing up the chain
      continue;
    }

    if (name === "variables") {
      variablesCall = link;
      continue;
    }

    // Check if this is a builder call like givenBuilder()
    if (BUILDER_NAMES[name]) {
      stepType = BUILDER_NAMES[name];
      continue;
    }
  }

  // The expression needs the whole chain: the statement supplies the text and
  // the interpolation order, the variables map supplies each hole's placeholder
  // (and, for custom parsers, the regex pattern the matcher should enforce).
  const { placeholders, parameters } = extractPlaceholderMap(
    variablesCall,
    sourceFile,
    ctx
  );
  let expression: string | null = statementCall
    ? extractExpression(statementCall, placeholders)
    : null;

  // If we didn't find the builder or expression in the chain, try the "re-exported" pattern:
  // const Given = givenBuilder<T>().statement;
  // Given("foo").step(...).register()
  if (!stepType || !expression) {
    const reExport = resolveReExportedCall(chain, ctx);
    if (reExport) {
      if (!stepType) stepType = reExport.stepType;
      if (!expression) expression = reExport.expression;
    }
  }

  if (!stepType || !expression) {
    return null;
  }

  const line =
    sourceFile.getLineAndCharacterOfPosition(registerCall.getStart()).line + 1;

  return {
    stepType,
    expression,
    dependencies,
    produces,
    sourceFile: sourceFile.fileName,
    line,
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
  };
}

/**
 * Collect all call expressions in the method chain, from register() back to the origin.
 */
function collectCallChain(call: ts.CallExpression): ts.CallExpression[] {
  const chain: ts.CallExpression[] = [call];
  let current: ts.Expression = call.expression;

  // Walk through PropertyAccessExpression to find the next call
  if (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  while (ts.isCallExpression(current)) {
    chain.push(current);
    current = current.expression;
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    }
  }

  return chain;
}

function getCallName(call: ts.CallExpression): string | null {
  const expr = call.expression;

  // .method() pattern
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }

  // direct call: functionName()
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }

  return null;
}

/**
 * The placeholder each built-in parser renders. Recognised by export name so
 * the common case (`.variables({ amount: intParser })`) resolves on the
 * parse-only fast path with no type information at all. The keys are
 * necessarily source-text identifiers, but the values come from the parsers
 * themselves so a renamed placeholder can't desync.
 */
const BUILTIN_PARSER_PLACEHOLDERS: Record<string, string> = {
  stringParser: stringParser.name,
  intParser: intParser.name,
  numberParser: numberParser.name,
  booleanParser: booleanParser.name,
};

function extractExpression(
  statementCall: ts.CallExpression,
  placeholders: Map<string, string>
): string | null {
  const arg = statementCall.arguments[0];
  if (!arg) return null;

  // String literal: .statement("a user")
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }

  // Token statement: .variables({name: parser}).statement(v => `a ${v.name}`)
  if (ts.isArrowFunction(arg)) {
    return extractExpressionFromArrowFunction(arg, placeholders);
  }

  return null;
}

/** What a parser expression resolves to: its placeholder name and, when the
 *  declaration's `regexp` is statically visible, the regex pattern to enforce. */
interface ResolvedParser {
  placeholder: string;
  pattern?: string;
}

/**
 * Resolve the `.variables()` map into variable name → placeholder name
 * (`amount` → `int`) plus a placeholder → regex-pattern record for custom
 * parsers. An entry whose parser can't be resolved is simply absent — the
 * template reconstruction falls back to `{string}` for it (after requesting a
 * type-checked retry if one hasn't happened yet).
 */
function extractPlaceholderMap(
  variablesCall: ts.CallExpression | null,
  sourceFile: ts.SourceFile,
  ctx: ExtractCtx
): { placeholders: Map<string, string>; parameters: Record<string, string> } {
  const placeholders = new Map<string, string>();
  const parameters: Record<string, string> = {};
  const arg = variablesCall?.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    return { placeholders, parameters };
  }

  for (const prop of arg.properties) {
    let varName: string | null = null;
    let parserExpr: ts.Expression | null = null;
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
    ) {
      varName = prop.name.text;
      parserExpr = prop.initializer;
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      varName = prop.name.text;
      parserExpr = prop.name;
    }
    if (!varName || !parserExpr) continue;

    const resolved = resolveParser(parserExpr, sourceFile, ctx);
    if (resolved) {
      placeholders.set(varName, resolved.placeholder);
      if (resolved.pattern) parameters[resolved.placeholder] = resolved.pattern;
    }
  }
  return { placeholders, parameters };
}

/**
 * Resolve a parser expression to its placeholder (the `name` property) and,
 * when visible, its regex pattern. Resolution order: built-in parsers by
 * export name, an inline object literal, a same-file `const` declaration, and
 * finally the type checker, which follows the symbol to its declaration — so
 * parsers imported from other modules resolve with their `regexp` pattern too.
 * On the parse-only pass an unresolved identifier flags `needsChecker` for the
 * one-time retry.
 */
function resolveParser(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  ctx: ExtractCtx
): ResolvedParser | null {
  if (ts.isObjectLiteralExpression(expr)) {
    return parserFromObjectLiteral(expr);
  }

  if (ts.isIdentifier(expr)) {
    const builtin = BUILTIN_PARSER_PLACEHOLDERS[expr.text];
    if (builtin) return { placeholder: builtin };

    const local = localParserIndex(sourceFile).get(expr.text);
    if (local) return local;
  }

  if (!ctx.checker) {
    ctx.needsChecker = true;
    return null;
  }
  try {
    // Follow the symbol (through import aliases) to its value declaration —
    // this reaches parsers declared in other modules and recovers their
    // `regexp` pattern, not just the placeholder name.
    let symbol = ctx.checker.getSymbolAtLocation(expr);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = ctx.checker.getAliasedSymbol(symbol);
    }
    if (symbol?.valueDeclaration) {
      const fromDeclaration = parserFromDeclaration(symbol.valueDeclaration);
      if (fromDeclaration) return fromDeclaration;
    }
    // Last resort: when the declaration isn't statically readable, the `name`
    // property's type may still be a string literal (e.g. a parser typed via
    // `satisfies` or left unannotated).
    const type = ctx.checker.getTypeAtLocation(expr);
    const nameSymbol = type.getProperty("name");
    if (nameSymbol) {
      const nameType = ctx.checker.getTypeOfSymbolAtLocation(nameSymbol, expr);
      if (nameType.isStringLiteral()) return { placeholder: nameType.value };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Resolve a parser object literal: `name` (required) and `regexp` (optional). */
function parserFromObjectLiteral(
  obj: ts.ObjectLiteralExpression
): ResolvedParser | null {
  let placeholder: string | null = null;
  let pattern: string | undefined;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === "name" && ts.isStringLiteral(prop.initializer)) {
      placeholder = prop.initializer.text;
    }
    if (prop.name.text === "regexp") {
      pattern = regexPatternFromExpression(prop.initializer);
    }
  }
  return placeholder ? { placeholder, pattern } : null;
}

/**
 * The regex source of a parser's `regexp` property: a regex literal's pattern,
 * or the `|`-joined patterns of an array of regex literals (mirroring how the
 * engine offers each as an alternative). Anything non-literal is skipped.
 */
function regexPatternFromExpression(expr: ts.Expression): string | undefined {
  if (ts.isRegularExpressionLiteral(expr)) {
    return regexSource(expr.text);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const sources = expr.elements
      .filter(ts.isRegularExpressionLiteral)
      .map(el => regexSource(el.text));
    if (sources.length === expr.elements.length && sources.length > 0) {
      return sources.map(s => `(?:${s})`).join("|");
    }
  }
  return undefined;
}

/** `/pattern/flags` → `pattern`. */
function regexSource(literalText: string): string {
  return literalText.slice(1, literalText.lastIndexOf("/"));
}

/**
 * A parser resolved from a variable declaration like
 * `const colorParser = { name: "color", regexp: ..., ... }` (possibly behind
 * `as`/`satisfies`/parens), or null if the declaration isn't that shape.
 */
function parserFromDeclaration(decl: ts.Declaration): ResolvedParser | null {
  if (!ts.isVariableDeclaration(decl) || !decl.initializer) return null;
  let init: ts.Expression = decl.initializer;
  while (
    ts.isAsExpression(init) ||
    ts.isSatisfiesExpression(init) ||
    ts.isParenthesizedExpression(init)
  ) {
    init = init.expression;
  }
  return ts.isObjectLiteralExpression(init)
    ? parserFromObjectLiteral(init)
    : null;
}

/**
 * Every parser-shaped `const` in a file, indexed by identifier in one walk and
 * cached per `SourceFile` — a step file whose N steps share one custom parser
 * resolves it with N map hits, not N full AST walks.
 */
const localParserIndexCache = new WeakMap<
  ts.SourceFile,
  Map<string, ResolvedParser>
>();
function localParserIndex(
  sourceFile: ts.SourceFile
): Map<string, ResolvedParser> {
  let index = localParserIndexCache.get(sourceFile);
  if (!index) {
    const built = new Map<string, ResolvedParser>();
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        !built.has(node.name.text)
      ) {
        const resolved = parserFromDeclaration(node);
        if (resolved) built.set(node.name.text, resolved);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    index = built;
    localParserIndexCache.set(sourceFile, index);
  }
  return index;
}

/**
 * How the statement function binds its token object: a plain parameter
 * (`v => ... ${v.amount}`) or a destructuring pattern
 * (`({ amount }) => ... ${amount}`, renames included). Used to map each
 * template hole back to its declared variable name.
 */
type TokenBinding =
  | { kind: "identifier"; name: string }
  | { kind: "destructured"; localToVariable: Map<string, string> };

function tokenBindingOf(fn: ts.ArrowFunction): TokenBinding | null {
  const param = fn.parameters[0];
  // A paramless statement can't reference tokens, so no hole can ever resolve
  // to a variable — an empty destructured binding states that directly.
  if (!param) return { kind: "destructured", localToVariable: new Map() };
  if (ts.isIdentifier(param.name)) {
    return { kind: "identifier", name: param.name.text };
  }
  if (ts.isObjectBindingPattern(param.name)) {
    const localToVariable = new Map<string, string>();
    for (const element of param.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const local = element.name.text;
      const declared =
        element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : local;
      localToVariable.set(local, declared);
    }
    return { kind: "destructured", localToVariable };
  }
  return null;
}

/** The declared variable name a template hole refers to, or null. */
function tokenVariableName(
  expr: ts.Expression,
  binding: TokenBinding
): string | null {
  if (binding.kind === "identifier") {
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === binding.name
    ) {
      return expr.name.text;
    }
    return null;
  }
  if (ts.isIdentifier(expr)) {
    return binding.localToVariable.get(expr.text) ?? null;
  }
  return null;
}

function extractExpressionFromArrowFunction(
  fn: ts.ArrowFunction,
  placeholders: Map<string, string>
): string | null {
  const binding = tokenBindingOf(fn);
  if (!binding) return null;

  // The body should be a template expression or string literal
  let body = fn.body;

  // If wrapped in a block with a return, unwrap
  if (ts.isBlock(body)) {
    const returnStmt = body.statements.find(ts.isReturnStatement);
    if (returnStmt?.expression) {
      body = returnStmt.expression;
    } else {
      return null;
    }
  }

  if (ts.isTemplateExpression(body)) {
    return reconstructExpressionFromTemplate(body, binding, placeholders);
  }

  if (ts.isNoSubstitutionTemplateLiteral(body)) {
    return body.text;
  }

  if (ts.isStringLiteral(body)) {
    return body.text;
  }

  return null;
}

function reconstructExpressionFromTemplate(
  template: ts.TemplateExpression,
  binding: TokenBinding,
  placeholders: Map<string, string>
): string {
  let result = template.head.text;

  for (const span of template.templateSpans) {
    const varName = tokenVariableName(span.expression, binding);
    const placeholder = varName ? placeholders.get(varName) : undefined;
    // A hole whose parser couldn't be resolved keeps the variable's own name
    // as its placeholder: the matcher treats an unknown placeholder as
    // match-anything, so "we don't know this parser" degrades to permissive
    // matching instead of silently borrowing string-parser semantics. The
    // unresolved path has already requested a type-checked retry, so this only
    // sticks when even the checker can't resolve it.
    result += `{${placeholder ?? varName ?? "string"}}`;
    result += span.literal.text;
  }

  return result;
}

function extractDependencies(
  depsCall: ts.CallExpression
): StepDefinitionMeta["dependencies"] {
  const deps: StepDefinitionMeta["dependencies"] = {
    given: {},
    when: {},
    then: {},
  };

  const arg = depsCall.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return deps;

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;

    const phase = prop.name.text as "given" | "when" | "then";
    if (!deps[phase]) continue;

    if (ts.isObjectLiteralExpression(prop.initializer)) {
      for (const innerProp of prop.initializer.properties) {
        if (
          ts.isPropertyAssignment(innerProp) &&
          ts.isIdentifier(innerProp.name) &&
          ts.isStringLiteral(innerProp.initializer)
        ) {
          const val = innerProp.initializer.text;
          if (val === "required" || val === "optional") {
            deps[phase][innerProp.name.text] = val;
          }
        }
      }
    }
  }

  return deps;
}

function extractProducedKeys(
  stepCall: ts.CallExpression,
  ctx: ExtractCtx
): string[] {
  const callback = stepCall.arguments[0];
  if (!callback) return [];

  // Try to get the return type of the callback by analyzing its body
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
    return extractProducedKeysFromCallback(callback, ctx);
  }

  return [];
}

function extractProducedKeysFromCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  ctx: ExtractCtx
): string[] {
  const body = callback.body;

  // Concise arrow: () => ({ key: value })
  if (!ts.isBlock(body)) {
    return extractKeysFromExpression(body, ctx);
  }

  // Block body: look at return statements
  const keys = new Set<string>();
  function visitReturn(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) {
      for (const key of extractKeysFromExpression(node.expression, ctx)) {
        keys.add(key);
      }
    }
    ts.forEachChild(node, visitReturn);
  }
  visitReturn(body);
  return [...keys];
}

function extractKeysFromExpression(
  expr: ts.Expression,
  ctx: ExtractCtx
): string[] {
  // Unwrap parenthesized expressions
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }

  // Object literal: { user: ..., token: ... }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties
      .filter(
        (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
          ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
      )
      .map(p => p.name.getText())
      .filter(Boolean);
  }

  // Non-literal return (a variable, a spread-only object, a function call): the
  // keys can only come from the type checker. On the parse-only pass we have
  // none — flag it so the caller retries with a real Program.
  if (!ctx.checker) {
    ctx.needsChecker = true;
    return [];
  }
  try {
    const type = ctx.checker.getTypeAtLocation(expr);
    return type
      .getProperties()
      .map(p => p.name)
      .filter(n => n !== "merge");
  } catch {
    return [];
  }
}

interface ReExportResult {
  stepType: StepType;
  expression: string | null;
}

function resolveReExportedCall(
  chain: ts.CallExpression[],
  ctx: ExtractCtx
): ReExportResult | null {
  // Look for the pattern: Variable("...")... where Variable was assigned from builderType().statement
  // The last call in the chain (furthest from register) should be the variable call

  const lastCall = chain[chain.length - 1];
  if (!lastCall) return null;

  const expr = lastCall.expression;

  // If it's an identifier (like "Given", "When", "Then"), trace its declaration
  let identifier: ts.Identifier | null = null;
  if (ts.isIdentifier(expr)) {
    identifier = expr;
  } else if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression)
  ) {
    identifier = expr.expression;
  }

  if (!identifier) return null;

  // Tracing the re-exported builder's declaration needs symbol resolution,
  // which only a real Program provides. Flag for the checked retry.
  if (!ctx.checker) {
    ctx.needsChecker = true;
    return null;
  }

  const symbol = ctx.checker.getSymbolAtLocation(identifier);
  if (!symbol) return null;

  const decl = symbol.valueDeclaration;
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer)
    return null;

  // Check if initializer is builderType<T>().statement
  const init = decl.initializer;

  // Pattern: givenBuilder<T>().statement  (PropertyAccessExpression)
  if (ts.isPropertyAccessExpression(init) && init.name.text === "statement") {
    const callExpr = init.expression;
    if (ts.isCallExpression(callExpr)) {
      const callee = callExpr.expression;
      if (ts.isIdentifier(callee) && BUILDER_NAMES[callee.text]) {
        // The lastCall IS the statement call — extract expression from it.
        // Re-exported statements are plain strings, so no variables map.
        const expression = extractExpression(lastCall, new Map());
        return {
          stepType: BUILDER_NAMES[callee.text],
          expression,
        };
      }
    }
  }

  return null;
}
