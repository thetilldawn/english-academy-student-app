import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;

export type ModuleBoundaryViolationKind =
  | "browser-global"
  | "endpoint-literal"
  | "forbidden-module"
  | "jsx"
  | "network"
  | "non-static-module"
  | "tsx-file";

export type ModuleBoundaryViolation = {
  file: string;
  line: number;
  column: number;
  kind: ModuleBoundaryViolationKind;
  detail: string;
};

export type ModuleBoundaryPolicy = {
  root: string;
  allowModule: (
    specifier: string,
    importer: string,
    typeOnly: boolean,
  ) => boolean;
  forbidEndpointLiterals?: boolean;
  forbidJsx?: boolean;
  forbidBrowserGlobals?: boolean;
  forbidNetwork?: boolean;
};

const BROWSER_GLOBALS = new Set([
  "document",
  "localStorage",
  "navigator",
  "sessionStorage",
  "window",
  "XMLHttpRequest",
  "WebSocket",
]);

export function collectBoundarySourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === "__tests__") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (
        entry.isFile() &&
        SOURCE_EXTENSION_PATTERN.test(entry.name) &&
        !TEST_FILE_PATTERN.test(entry.name)
      ) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files.toSorted();
}

function lineAndColumn(source: ts.SourceFile, node: ts.Node) {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: position.line + 1, column: position.character + 1 };
}

type ModuleReference = {
  specifier: ts.StringLiteralLike;
  typeOnly: boolean;
};

function isModuleLoaderCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return true;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const owner = node.expression.expression;
    return (
      (ts.isIdentifier(owner) &&
        owner.text === "module" &&
        node.expression.name.text === "require") ||
      (ts.isIdentifier(owner) &&
        owner.text === "require" &&
        node.expression.name.text === "resolve")
    );
  }
  return false;
}

function moduleReferenceFromNode(node: ts.Node): ModuleReference | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const typeOnly = ts.isImportDeclaration(node)
      ? !!node.importClause &&
        (node.importClause.isTypeOnly ||
          (!node.importClause.name &&
            !!node.importClause.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.length > 0 &&
            node.importClause.namedBindings.elements.every(
              (element) => element.isTypeOnly,
            )))
      : node.isTypeOnly ||
        (!!node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((element) => element.isTypeOnly));
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? {
          specifier: node.moduleSpecifier,
          typeOnly,
        }
      : null;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return {
      specifier: node.moduleReference.expression,
      typeOnly: node.isTypeOnly,
    };
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteralLike(node.argument.literal)
  ) {
    return { specifier: node.argument.literal, typeOnly: true };
  }
  if (ts.isCallExpression(node) && isModuleLoaderCall(node)) {
    const [argument] = node.arguments;
    return argument && ts.isStringLiteralLike(argument)
      ? { specifier: argument, typeOnly: false }
      : null;
  }
  return null;
}

function isIdentifierNamePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    ts.isTypeReferenceNode(parent)
  ) {
    return true;
  }
  return false;
}

function isFetchReference(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === "fetch";
  if (ts.isPropertyAccessExpression(node)) {
    return (
      node.name.text === "fetch" &&
      ts.isIdentifier(node.expression) &&
      ["global", "globalThis", "self", "window"].includes(
        node.expression.text,
      )
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      ["global", "globalThis", "self", "window"].includes(
        node.expression.text,
      ) &&
      !!node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "fetch"
    );
  }
  return false;
}

function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
      parent.moduleSpecifier === node
  ) ||
    (ts.isExternalModuleReference(parent) && parent.expression === node) ||
    (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
    (ts.isCallExpression(parent) &&
      isModuleLoaderCall(parent) &&
      parent.arguments[0] === node);
}

function bindingNameContains(
  name: ts.BindingName,
  identifier: string,
): boolean {
  if (ts.isIdentifier(name)) return name.text === identifier;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) &&
      bindingNameContains(element.name, identifier),
  );
}

function isFunctionParameterReference(node: ts.Identifier): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some((parameter) =>
        bindingNameContains(parameter.name, node.text)
      )
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

export function inspectBoundarySource(
  file: string,
  sourceText: string,
  policy: ModuleBoundaryPolicy,
): ModuleBoundaryViolation[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: ModuleBoundaryViolation[] = [];
  const seen = new Set<string>();

  const report = (
    node: ts.Node,
    kind: ModuleBoundaryViolationKind,
    detail: string,
  ) => {
    const location = lineAndColumn(source, node);
    const key = `${kind}:${location.line}:${location.column}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ file, ...location, kind, detail });
  };

  if (policy.forbidJsx && /\.[cm]?[jt]sx$/.test(file)) {
    report(source, "tsx-file", "JSX-capable files are not allowed in this layer.");
  }

  const visit = (node: ts.Node) => {
    const moduleReference = moduleReferenceFromNode(node);
    if (
      moduleReference &&
      !policy.allowModule(
        moduleReference.specifier.text,
        file,
        moduleReference.typeOnly,
      )
    ) {
      report(
        moduleReference.specifier,
        "forbidden-module",
        `Module is outside this layer's allowlist: ${moduleReference.specifier.text}`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      isModuleLoaderCall(node) &&
      !moduleReference
    ) {
      report(
        node,
        "non-static-module",
        "Module loaders must use a static string literal.",
      );
    }

    if (
      policy.forbidJsx &&
      (ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node))
    ) {
      report(node, "jsx", "JSX is not allowed in this layer.");
    }

    if (
      policy.forbidNetwork !== false &&
      ts.isCallExpression(node) &&
      isFetchReference(node.expression)
    ) {
      report(node.expression, "network", "Network execution is not allowed.");
    } else if (
      policy.forbidNetwork !== false &&
      ts.isIdentifier(node) &&
      node.text === "fetch" &&
      !isIdentifierNamePosition(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      )
    ) {
      report(node, "network", "The fetch API is not allowed in this layer.");
    } else if (
      policy.forbidNetwork !== false &&
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isFetchReference(node)
    ) {
      report(node, "network", "The fetch API is not allowed in this layer.");
    }

    if (
      policy.forbidBrowserGlobals &&
      ts.isIdentifier(node) &&
      !isIdentifierNamePosition(node) &&
      !isFunctionParameterReference(node) &&
      BROWSER_GLOBALS.has(node.text)
    ) {
      report(
        node,
        "browser-global",
        `Browser global is not allowed: ${node.text}`,
      );
    }

    if (
      policy.forbidEndpointLiterals &&
      (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isModuleSpecifier(node) &&
      node.text.includes("/api/")
    ) {
      report(node, "endpoint-literal", "Domain code cannot contain API endpoints.");
    }
    if (
      policy.forbidEndpointLiterals &&
      ts.isTemplateExpression(node) &&
      [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].some((text) => text.includes("/api/"))
    ) {
      report(node, "endpoint-literal", "Domain code cannot contain API endpoints.");
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function findModuleBoundaryViolations(
  policy: ModuleBoundaryPolicy,
): ModuleBoundaryViolation[] {
  return collectBoundarySourceFiles(policy.root).flatMap((file) =>
    inspectBoundarySource(file, fs.readFileSync(file, "utf8"), policy),
  );
}

export function formatModuleBoundaryViolations(
  violations: readonly ModuleBoundaryViolation[],
): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${violation.line}:${violation.column} [${violation.kind}] ${violation.detail}`,
    )
    .join("\n");
}

export function resolvesInside(
  importer: string,
  specifier: string,
  allowedRoots: readonly string[],
): boolean {
  const resolved = specifier.startsWith("@/")
    ? path.resolve("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;
  if (!resolved) return false;
  return allowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
