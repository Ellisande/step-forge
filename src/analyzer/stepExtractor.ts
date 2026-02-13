import ts from "typescript";
import { StepDefinitionMeta } from "./types.js";

type StepType = "given" | "when" | "then";

const BUILDER_NAMES: Record<string, StepType> = {
  givenBuilder: "given",
  whenBuilder: "when",
  thenBuilder: "then",
};

export function extractStepDefinitions(
  filePaths: string[],
  tsConfigPath?: string
): StepDefinitionMeta[] {
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

  const program = ts.createProgram(filePaths, compilerOptions);
  const checker = program.getTypeChecker();
  const results: StepDefinitionMeta[] = [];

  for (const filePath of filePaths) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;
    const fileResults = extractFromSourceFile(sourceFile, checker);
    results.push(...fileResults);
  }

  return results;
}

function extractFromSourceFile(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): StepDefinitionMeta[] {
  const results: StepDefinitionMeta[] = [];

  function visit(node: ts.Node) {
    // Look for .register() call expressions
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "register"
    ) {
      const meta = extractFromRegisterCall(node, sourceFile, checker);
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
  checker: ts.TypeChecker
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
      produces = extractProducedKeys(link, checker);
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
    const reExport = resolveReExportedCall(chain, checker);
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
  checker: ts.TypeChecker
): string[] {
  const callback = stepCall.arguments[0];
  if (!callback) return [];

  // Try to get the return type of the callback by analyzing its body
  if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
    return extractProducedKeysFromCallback(callback, checker);
  }

  return [];
}

function extractProducedKeysFromCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  checker: ts.TypeChecker
): string[] {
  const body = callback.body;

  // Concise arrow: () => ({ key: value })
  if (!ts.isBlock(body)) {
    return extractKeysFromExpression(body, checker);
  }

  // Block body: look at return statements
  const keys = new Set<string>();
  function visitReturn(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) {
      for (const key of extractKeysFromExpression(node.expression, checker)) {
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
  checker: ts.TypeChecker
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

  // Try type checker as fallback
  try {
    const type = checker.getTypeAtLocation(expr);
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
  checker: ts.TypeChecker
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

  const symbol = checker.getSymbolAtLocation(identifier);
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
