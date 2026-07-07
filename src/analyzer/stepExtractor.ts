import ts from "typescript";
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
  let expression: string | null = null;
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
      expression = extractExpression(link);
      // Try to find the builder type by continuing up the chain
      continue;
    }

    // Check if this is a builder call like givenBuilder()
    if (BUILDER_NAMES[name]) {
      stepType = BUILDER_NAMES[name];
      continue;
    }
  }

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
  };
}

/**
 * Collect all call expressions in the method chain, from register() back to the origin.
 */
function collectCallChain(call: ts.CallExpression): ts.CallExpression[] {
  const chain: ts.CallExpression[] = [call];
  let current: ts.Expression = call.expression;

  while (true) {
    // Walk through PropertyAccessExpression to find the next call
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    }

    if (ts.isCallExpression(current)) {
      chain.push(current);
      current = current.expression;
    } else {
      break;
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

function extractExpression(statementCall: ts.CallExpression): string | null {
  const arg = statementCall.arguments[0];
  if (!arg) return null;

  // String literal: .statement("a user")
  if (ts.isStringLiteral(arg)) {
    return arg.text;
  }

  // Arrow function with template literal: .statement((name: string) => `a user named ${name}`)
  if (ts.isArrowFunction(arg)) {
    return extractExpressionFromArrowFunction(arg);
  }

  return null;
}

function extractExpressionFromArrowFunction(
  fn: ts.ArrowFunction
): string | null {
  const params = fn.parameters.map((p) => p.name.getText());

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
    return reconstructExpressionFromTemplate(body, params);
  }

  if (ts.isNoSubstitutionTemplateLiteral(body)) {
    return body.text;
  }

  return null;
}

function reconstructExpressionFromTemplate(
  template: ts.TemplateExpression,
  paramNames: string[]
): string {
  let result = template.head.text;

  for (const span of template.templateSpans) {
    if (ts.isIdentifier(span.expression) && paramNames.includes(span.expression.text)) {
      result += "{string}";
    } else {
      // Non-parameter expression, use {string} as fallback
      result += "{string}";
    }
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
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name))
      continue;

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
      .map((p) => p.name.getText())
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
      .map((p) => p.name)
      .filter((n) => n !== "merge");
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
        // The lastCall IS the statement call — extract expression from it
        const expression = extractExpression(lastCall);
        return {
          stepType: BUILDER_NAMES[callee.text],
          expression,
        };
      }
    }
  }

  return null;
}
