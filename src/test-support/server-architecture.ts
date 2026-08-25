import path from "node:path";

import ts from "typescript";

export type RuntimeImport = {
  file: string;
  module: string;
  importedName: string;
  localName: string;
  callCount: number;
};

export type SharedCacheViolation = {
  file: string;
  reason: string;
};

export type DirectDbWriteCall = {
  file: string;
  method: "delete" | "insert" | "rpc" | "update" | "upsert";
  line: number;
  operation?: string;
};

const WRITE_MODULE_PATTERN =
  /(?:^|[/.-])(?:command|commands|finalizer|materializer|mutation|mutations|write|writes)(?:[/.-]|$)/;
const WRITE_BINDING_PATTERN =
  /^(?:cancel|delete|expire|finalize|insert|materialize|record|replace|restore|revoke|rotate|save|submit|update|upsert)(?:[A-Z_]|$)/;
const DIRECT_DB_WRITE_METHODS = new Set<DirectDbWriteCall["method"]>([
  "delete",
  "insert",
  "update",
  "upsert",
]);
const MUTATING_RPC_PATTERN =
  /^(?:assign|cancel|create|delete|expire|finalize|insert|materialize|persist|queue|record|replace|restore|revoke|rotate|save|submit|update|upsert)(?:_|$)/;

function sourceFile(file: string, source: string) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function countIdentifierCalls(source: ts.SourceFile, identifier: string) {
  let calls = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === identifier
    ) {
      calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

export function collectRuntimeImports(
  file: string,
  source: string,
): RuntimeImport[] {
  const parsed = sourceFile(file, source);
  const imports: Array<Omit<RuntimeImport, "callCount">> = [];

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;

    if (clause.name) {
      imports.push({
        file,
        module: moduleSpecifier,
        importedName: "default",
        localName: clause.name.text,
      });
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.push({
        file,
        module: moduleSpecifier,
        importedName: "*",
        localName: clause.namedBindings.name.text,
      });
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        imports.push({
          file,
          module: moduleSpecifier,
          importedName: element.propertyName?.text ?? element.name.text,
          localName: element.name.text,
        });
      }
    }
  }

  return imports.map((entry) => ({
    ...entry,
    callCount: countIdentifierCalls(parsed, entry.localName),
  }));
}

export function collectQueryWriteEdges(file: string, source: string) {
  const edges = collectRuntimeImports(file, source).filter(
    (entry) =>
      WRITE_MODULE_PATTERN.test(entry.module) ||
      WRITE_BINDING_PATTERN.test(entry.importedName),
  );
  const parsed = sourceFile(file, source);
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      WRITE_MODULE_PATTERN.test(node.arguments[0].text)
    ) {
      edges.push({
        file,
        module: node.arguments[0].text,
        importedName: "*",
        localName: "<dynamic import>",
        callCount: 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return edges;
}

export function collectDirectDbWriteCalls(
  file: string,
  source: string,
): DirectDbWriteCall[] {
  const parsed = sourceFile(file, source);
  const calls: DirectDbWriteCall[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      DIRECT_DB_WRITE_METHODS.has(
        node.expression.name.text as DirectDbWriteCall["method"],
      )
    ) {
      calls.push({
        file,
        method: node.expression.name.text as DirectDbWriteCall["method"],
        line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
      });
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "rpc" &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      MUTATING_RPC_PATTERN.test(node.arguments[0].text)
    ) {
      calls.push({
        file,
        method: "rpc",
        operation: node.arguments[0].text,
        line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
}

export function isReadModulePath(file: string) {
  const normalized = file.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  return (
    /(?:^|-)(?:list|load|read|query)(?:-|\.)/.test(basename) ||
    normalized.includes("/server/queries/") ||
    normalized.endsWith("/lib/services/wrong-word-service.ts")
  );
}

export function hasTopLevelDirective(
  file: string,
  source: string,
  directive: string,
) {
  const parsed = sourceFile(file, source);
  for (const statement of parsed.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === directive) return true;
      continue;
    }
    break;
  }
  return false;
}

function hasCacheDirective(file: string, source: string) {
  const parsed = sourceFile(file, source);
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text.startsWith("use cache")
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

const SHARED_CACHE_FORBIDDEN_PATTERNS = [
  { pattern: /["']next\/headers["']/, reason: "request header access" },
  {
    pattern: /["'][^"']*\/auth\/[^"']*["']/,
    reason: "identity module import",
  },
  {
    pattern: /["'][^"']*(?:\/supabase\/|@supabase\/)[^"']*["']/,
    reason: "database client import",
  },
  {
    pattern: /["'][^"']*\/services\/[^"']*["']/,
    reason: "unreviewed service indirection",
  },
  {
    pattern: /\.\s*(?:from|rpc)\s*\(/,
    reason: "direct database query",
  },
  { pattern: /service[_-]?role/i, reason: "service-role credential or helper" },
] as const;

export function inspectSharedCacheSource(
  file: string,
  source: string,
): SharedCacheViolation[] {
  if (!hasCacheDirective(file, source)) return [];
  return SHARED_CACHE_FORBIDDEN_PATTERNS.filter(({ pattern }) =>
    pattern.test(source),
  ).map(({ reason }) => ({ file, reason }));
}

export function countRouterRefreshCalls(file: string, source: string) {
  const parsed = sourceFile(file, source);
  const useRouterNames = new Set<string>();
  const routerBindings = new Set<string>();
  const refreshBindings = new Set<string>();

  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "next/navigation") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "useRouter") {
        useRouterNames.add(element.name.text);
      }
    }
  }

  const registerBinding = (declaration: ts.VariableDeclaration) => {
    const initializer = declaration.initializer;
    if (!initializer) return;
    if (
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      useRouterNames.has(initializer.expression.text)
    ) {
      if (ts.isIdentifier(declaration.name)) {
        routerBindings.add(declaration.name.text);
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          const propertyName = element.propertyName;
          const sourceName =
            propertyName && ts.isIdentifier(propertyName)
              ? propertyName.text
              : ts.isIdentifier(element.name)
                ? element.name.text
                : "";
          if (sourceName === "refresh" && ts.isIdentifier(element.name)) {
            refreshBindings.add(element.name.text);
          }
        }
      }
      return;
    }
    if (
      ts.isIdentifier(declaration.name) &&
      ts.isIdentifier(initializer) &&
      routerBindings.has(initializer.text)
    ) {
      routerBindings.add(declaration.name.text);
      return;
    }
    if (
      ts.isIdentifier(declaration.name) &&
      ts.isPropertyAccessExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      routerBindings.has(initializer.expression.text) &&
      initializer.name.text === "refresh"
    ) {
      refreshBindings.add(declaration.name.text);
    }
  };

  const register = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) registerBinding(node);
    ts.forEachChild(node, register);
  };
  register(parsed);

  let calls = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        routerBindings.has(node.expression.expression.text) &&
        node.expression.name.text === "refresh") ||
        (ts.isIdentifier(node.expression) &&
          refreshBindings.has(node.expression.text)))
    ) {
      calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
}
