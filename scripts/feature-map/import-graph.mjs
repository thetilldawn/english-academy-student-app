import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  isProductionService,
  relative,
  root,
  walk,
} from "./common.mjs";

export function resolveImport(importer, specifier) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(root, importer)), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.css`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    path.join(base, "index.mts"),
    path.join(base, "index.cts"),
    path.join(base, "index.mjs"),
    path.join(base, "index.cjs"),
  ];
  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  return resolved ? relative(resolved) : null;
}

export function extractImportSpecifiers(
  source,
  filePath = "feature-map.ts",
  { runtimeOnly = false } = {},
) {
  const specifiers = new Set();
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const moduleLoaderName = (expression) => {
    if (expression.kind === ts.SyntaxKind.ImportKeyword) return "import";
    if (ts.isIdentifier(expression) && expression.text === "require") return "require";
    if (!ts.isPropertyAccessExpression(expression)) return null;
    const owner = expression.expression;
    if (ts.isIdentifier(owner) && owner.text === "module" && expression.name.text === "require") {
      return "module.require";
    }
    if (ts.isIdentifier(owner) && owner.text === "require" && expression.name.text === "resolve") {
      return "require.resolve";
    }
    return null;
  };
  const importDeclarationIsTypeOnly = (node) => {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.name) return false;
    return ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly);
  };
  const exportDeclarationIsTypeOnly = (node) => {
    if (node.isTypeOnly) return true;
    return Boolean(node.exportClause) &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly);
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? importDeclarationIsTypeOnly(node)
        : exportDeclarationIsTypeOnly(node);
      if (!runtimeOnly || !typeOnly) specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      if (!runtimeOnly || !node.isTypeOnly) specifiers.add(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      if (!runtimeOnly) specifiers.add(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && moduleLoaderName(node.expression)) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) {
        specifiers.add(argument.text);
      } else {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        throw new Error(
          `${filePath}:${position.line + 1}:${position.character + 1} 비정적 모듈 로더는 허용하지 않습니다.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

export function verifyImportScanner(errors) {
  const sample = [
    'import type { A } from "@/features/a/domain/a";',
    'export { B } from "@/features/b/ui/b";',
    'export { type TypeOnlyExport } from "@/features/type-only-export/domain/value";',
    'const c = await import("@/features/c/server/c");',
    'const d = require("@/features/d/ui/d");',
    'type E = typeof import("@/features/e/contracts/e");',
    'import F = require("@/features/f/domain/f");',
    'const g = module.require("@/features/g/ui/g");',
    'const h = require.resolve("@/features/h/contracts/h");',
  ].join("\n");
  const expected = [
    "@/features/a/domain/a",
    "@/features/b/ui/b",
    "@/features/type-only-export/domain/value",
    "@/features/c/server/c",
    "@/features/d/ui/d",
    "@/features/e/contracts/e",
    "@/features/f/domain/f",
    "@/features/g/ui/g",
    "@/features/h/contracts/h",
  ];
  const actual = extractImportSpecifiers(sample);
  for (const specifier of expected) {
    if (!actual.has(specifier)) errors.push(`import 검사기 self-test 실패: ${specifier}`);
  }
  const runtimeActual = extractImportSpecifiers(sample, "feature-map.ts", { runtimeOnly: true });
  for (const typeOnlySpecifier of [
    "@/features/a/domain/a",
    "@/features/e/contracts/e",
    "@/features/type-only-export/domain/value",
  ]) {
    if (runtimeActual.has(typeOnlySpecifier)) {
      errors.push(`runtime import 검사기가 type-only 경로를 포함했습니다: ${typeOnlySpecifier}`);
    }
  }
  try {
    extractImportSpecifiers("const hidden = require(target);", "non-static-self-test.ts");
    errors.push("import 검사기 self-test 실패: 비정적 require를 거부하지 않았습니다.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("비정적 모듈 로더")) {
      errors.push("import 검사기 self-test 실패: 비정적 require 오류가 올바르지 않습니다.");
    }
  }
}

export function verifyStaticOwnedImports(errors) {
  const roots = [
    "src/app",
    "src/features",
    "src/components",
    "src/design-system",
    "src/lib",
    "src/content",
    "src/server",
    "src/test-support",
  ];
  for (const directory of roots) {
    for (const absoluteFile of walk(path.join(root, directory)).filter(isProductionService)) {
      const filePath = relative(absoluteFile);
      try {
        extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), filePath);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

export function collectCrossFeatureImports() {
  const files = walk(path.join(root, "src", "features"))
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => !/\.(test|spec)\.(ts|tsx)$/.test(filePath));
  const edges = [];
  for (const absoluteFile of files) {
    const importer = relative(absoluteFile);
    const fromMatch = importer.match(/^src\/features\/([^/]+)\//);
    if (!fromMatch) continue;
    for (const specifier of extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), importer)) {
      const target = resolveImport(importer, specifier);
      const toMatch = target?.match(/^src\/features\/([^/]+)\//);
      if (!target || !toMatch || fromMatch[1] === toMatch[1]) continue;
      edges.push({ from: importer, to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
}

export function collectLibToFeatureImports() {
  const files = walk(path.join(root, "src", "lib")).filter(isProductionService);
  const edges = [];
  for (const absoluteFile of files) {
    const importer = relative(absoluteFile);
    for (const specifier of extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), importer)) {
      const target = resolveImport(importer, specifier);
      if (target?.startsWith("src/features/")) edges.push({ from: importer, to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
}

export function collectFeatureToLibBridges(libToFeatureImports) {
  const bridgeSources = new Set(libToFeatureImports.map(({ from }) => from));
  const files = walk(path.join(root, "src", "features")).filter(isProductionService);
  const edges = [];
  for (const absoluteFile of files) {
    const importer = relative(absoluteFile);
    for (const specifier of extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), importer)) {
      const target = resolveImport(importer, specifier);
      if (target && bridgeSources.has(target)) edges.push({ from: importer, to: target });
    }
  }
  return edges.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
}

export function collectFeatureViaLibToFeatureImports() {
  const libFiles = walk(path.join(root, "src", "lib")).filter(isProductionService);
  const libGraph = new Map();
  for (const absoluteFile of libFiles) {
    const importer = relative(absoluteFile);
    const targets = [];
    for (const specifier of extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), importer)) {
      const target = resolveImport(importer, specifier);
      if (target?.startsWith("src/lib/") || target?.startsWith("src/features/")) targets.push(target);
    }
    libGraph.set(importer, [...new Set(targets)].sort());
  }

  const discovered = new Map();
  for (const absoluteFile of walk(path.join(root, "src", "features")).filter(isProductionService)) {
    const importer = relative(absoluteFile);
    const sourceFeature = importer.match(/^src\/features\/([^/]+)\//)?.[1];
    if (!sourceFeature) continue;
    const initialLibTargets = [];
    for (const specifier of extractImportSpecifiers(fs.readFileSync(absoluteFile, "utf8"), importer)) {
      const target = resolveImport(importer, specifier);
      if (target?.startsWith("src/lib/")) initialLibTargets.push(target);
    }
    const queue = [...new Set(initialLibTargets)].sort().map((target) => ({ node: target, via: [target] }));
    const visitedLibFiles = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visitedLibFiles.has(current.node)) continue;
      visitedLibFiles.add(current.node);
      for (const target of libGraph.get(current.node) ?? []) {
        if (target.startsWith("src/lib/")) {
          queue.push({ node: target, via: [...current.via, target] });
          continue;
        }
        const targetFeature = target.match(/^src\/features\/([^/]+)\//)?.[1];
        if (!targetFeature || targetFeature === sourceFeature) continue;
        const key = `${importer}|${target}`;
        const candidate = { from: importer, to: target, via: current.via };
        const existing = discovered.get(key);
        if (
          !existing ||
          candidate.via.length < existing.via.length ||
          (candidate.via.length === existing.via.length &&
            candidate.via.join("|").localeCompare(existing.via.join("|")) < 0)
        ) {
          discovered.set(key, candidate);
        }
      }
    }
  }
  return [...discovered.values()].sort((a, b) =>
    `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`),
  );
}
