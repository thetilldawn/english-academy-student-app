import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectBoundarySourceFiles, inspectBoundarySource } from "@/test-support/module-boundary";

const root = process.cwd();
const uiRoot = path.join(root, "src/features/assignments/ui");
type Entry = { path: string; role: "assembly" | "pure" | "interaction" | "deferred"; reason: string; allowedImports: string[]; legacySourceSha256?: string };
const registry = JSON.parse(fs.readFileSync(path.join(root, "architecture/assignment-ui-roles.json"), "utf8")) as { schemaVersion: number; entries: Entry[] };
const byPath = new Map(registry.entries.map((entry) => [entry.path, entry]));
const reusable = registry.entries.filter((entry) => ["pure", "interaction"].includes(entry.role));

function registryErrors(value: typeof registry, actual: string[]) {
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push("지원하지 않는 UI 분류 형식");
  const names = value.entries.map((entry) => entry.path);
  if (new Set(names).size !== names.length) errors.push("중복 분류");
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...actual].sort())) errors.push("UI 파일/분류 불일치");
  for (const entry of value.entries) {
    if (!["assembly", "pure", "interaction", "deferred"].includes(entry.role) || entry.reason.trim().length < 8) errors.push("역할/근거 누락");
  }
  return errors;
}

// Type-check the shape, not its local alias/name. Arrays, unions and nested props retain this check.
function hasWholeState(checker: ts.TypeChecker, type: ts.Type, depth = 0, seen = new Set<ts.Type>()): boolean {
  if (depth > 5 || seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection()) return type.types.some((part) => hasWholeState(checker, part, depth, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const properties = checker.getPropertiesOfType(type);
  const names = new Set(properties.map((property) => property.name));
  const has = (...keys: string[]) => keys.every((key) => names.has(key));
  if ((names.has("actions") && ["draft", "state", "planner"].some((key) => names.has(key))) ||
      has("planner", "bulk") || has("exam", "range", "operation") ||
      has("exam", "studentId", "deadline", "questionCount") || has("exam", "commonPlan") ||
      has("planNonce", "range", "schedule") || has("directionRatio", "passingScore", "retryEnabled", "timing")) return true;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker.getTypeArguments(type as ts.TypeReference).some((part) => hasWholeState(checker, part, depth + 1, seen));
  }
  return properties.some((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration || declaration.getSourceFile().fileName.includes("node_modules")) return false;
    return hasWholeState(checker, checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, seen);
  });
}

function hasErasedInput(checker: ts.TypeChecker, type: ts.Type, depth = 0, seen = new Set<ts.Type>()): boolean {
  if (depth > 5 || seen.has(type)) return false;
  seen.add(type);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
  if (type.isUnionOrIntersection()) return type.types.some((part) => hasErasedInput(checker, part, depth, seen));
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker.getTypeArguments(type as ts.TypeReference).some((part) => hasErasedInput(checker, part, depth + 1, seen));
  }
  if (checker.getIndexInfosOfType(type).some((index) => hasErasedInput(checker, index.type, depth + 1, seen))) return true;
  return checker.getPropertiesOfType(type).some((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration || declaration.getSourceFile().fileName.includes("node_modules")) return false;
    return hasErasedInput(checker, checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, seen);
  });
}

function inspectInputs(program: ts.Program, file: string, inspectParameters = true,
  isReusableTarget: (declaration: ts.Declaration) => boolean = () => true) {
  const checker = program.getTypeChecker(), source = program.getSourceFile(file)!;
  const errors: string[] = [];
  function checkValue(node: ts.Node, checkErasure = true) {
    const type = checker.getTypeAtLocation(node);
    if (hasWholeState(checker, type)) errors.push("전체 상태 전달: " + node.getText(source).slice(0, 100));
    if (checkErasure && hasErasedInput(checker, type)) errors.push("입력 타입 지우기: " + node.getText(source).slice(0, 100));
  }
  function visit(node: ts.Node) {
    if (inspectParameters && ts.isAsExpression(node) && [ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword].includes(node.type.kind)) {
      errors.push("입력 타입 지우기: " + node.getText(source).slice(0, 100));
    }
    // Inferred library callback placeholders (e.g. Array.from's unused value) are not app input declarations.
    if (inspectParameters && ts.isParameter(node)) checkValue(node, Boolean(node.type));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let symbol = checker.getSymbolAtLocation(node.tagName);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (symbol?.declarations?.some(isReusableTarget)) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) checkValue(attribute.expression);
          else if (attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
            checkValue(attribute.initializer.expression);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return errors;
}

describe("배정 UI 전체 역할과 재사용 경계", () => {
  it("모든 TS/TSX 부품에 중복 없는 역할과 근거를 요구한다", () => {
    const actual = collectBoundarySourceFiles(uiRoot).map((file) => path.basename(file));
    expect(registryErrors(registry, actual)).toEqual([]);
    expect(registryErrors({ ...registry, schemaVersion: 2 }, actual)).not.toEqual([]);
    expect(registryErrors({ ...registry, entries: registry.entries.slice(1) }, actual)).not.toEqual([]);
    expect(registryErrors({ ...registry, entries: [...registry.entries, registry.entries[0]] }, actual)).not.toEqual([]);
  });
  it.each(registry.entries)("$path의 검토된 실제 import/타입/재수출 경로만 허용한다", (entry) => {
    const reusableEntry = entry.role === "pure" || entry.role === "interaction";
    const file = path.join(uiRoot, entry.path);
    if (entry.role === "deferred") {
      expect(createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex"),
        "후속 분리 파일 변경은 연결부 예외로 우회하지 않고 의존/전체 상태를 다시 검토하고 기록합니다.").toBe(entry.legacySourceSha256);
    }
    const violations = inspectBoundarySource(file, fs.readFileSync(file, "utf8"), {
      root: uiRoot,
      allowModule: (specifier) => {
        if (!entry.allowedImports.includes(specifier)) return false;
        if (!reusableEntry) return true;
        if (/(?:^|\/)controller\//.test(specifier) || specifier.includes("/client/controllers/") || specifier.startsWith("sonner") || specifier.startsWith("next/")) return false;
        if (specifier.startsWith("./") && !specifier.endsWith(".css")) {
          const stem = specifier.slice(2), child = byPath.get(stem + ".tsx") ?? byPath.get(stem + ".ts");
          if (child && !["pure", "interaction"].includes(child.role)) return false;
        }
        return true;
      },
      forbidNetwork: reusableEntry, forbidEndpointLiterals: reusableEntry,
      forbidBrowserGlobals: entry.role === "pure",
    });
    expect(violations).toEqual([]);
  });
  it("별칭/인덱스/Pick/ReturnType/펼치기로도 재사용 입력에 전체 상태를 전달하지 못한다", () => {
    const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
    const reusableFiles = new Set(reusable.map((entry) => path.normalize(path.join(uiRoot, entry.path))));
    const files = registry.entries.map((entry) => path.join(uiRoot, entry.path));
    const program = ts.createProgram([...files, path.join(root, "next-env.d.ts")], { ...config.options, noEmit: true });
    const findings = files.flatMap((file) => inspectInputs(program, file, reusableFiles.has(path.normalize(file)),
      (declaration) => reusableFiles.has(path.normalize(declaration.getSourceFile().fileName)))
      .map((error) => path.basename(file) + ": " + error));
    expect(findings).toEqual([]);
  }, 20000);
  it("검사 자체가 전체 상태 별칭과 펼치기를 잡고 좁은 Pick은 허용한다", () => {
    const file = path.join(root, "__ui_boundary_fixture__.tsx");
    const source = `type Pick<T, K extends keyof T> = { [P in K]: T[P] };
      type ReturnType<T> = T extends (...args: never[]) => infer R ? R : never;
      type Full = { actions: { change(): void }; draft: { value: number } };
      declare function create(): Full;
      type Alias = ReturnType<typeof create>; type Indirect = { model: Alias }['model'];
      declare const View: (p: { safe: number }) => unknown;
      function Bad(p: { data: Pick<Indirect, keyof Indirect> }) { return <View {...p.data} />; }
      function Good(p: Pick<Full['draft'], 'value'>) { return p.value; }`;
    const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, noLib: true };
    const host = ts.createCompilerHost(options), read = host.getSourceFile;
    host.getSourceFile = (name, version, onError, fresh) => path.resolve(name) === file ? ts.createSourceFile(name, source, version, true, ts.ScriptKind.TSX) : read(name, version, onError, fresh);
    const program = ts.createProgram([file], options, host);
    const findings = inspectInputs(program, file);
    expect(findings).toHaveLength(2);
    expect(findings.some((finding) => finding.includes("Pick<Indirect"))).toBe(true);
    expect(findings.some((finding) => finding.endsWith("p.data"))).toBe(true);
  });
  it("좁은 수신 Pick에도 조립부의 큰 named 속성/펼치기와 타입 지우기를 막는다", () => {
    const file = path.join(root, "__ui_caller_fixture__.tsx");
    const source = `type Pick<T, K extends keyof T> = { [P in K]: T[P] };
      type Exam = { directionRatio: number; passingScore: number; retryEnabled: boolean; timing: number };
      declare const View: (p: { exam: Pick<Exam, 'passingScore'> }) => unknown;
      declare const whole: Exam; declare const erased: any;
      function Assembly(controller: { actions: {}; state: {} }) {
        return <><View exam={whole} /><View {...{ exam: whole }} /><View exam={erased} />
          <View exam={{ passingScore: 80 }} /></>;
      }
      function BadAny(p: { model: any }) { return p; }
      function BadUnknown(p: { model: unknown }) { return p; }
      function BadArray(p: { model: any[] }) { return p; }
      function BadUnknownArray(p: { model: unknown[] }) { return p; }`;
    const options: ts.CompilerOptions = { noEmit: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext };
    const host = ts.createCompilerHost(options), read = host.getSourceFile;
    host.getSourceFile = (name, version, onError, fresh) => path.resolve(name) === file ? ts.createSourceFile(name, source, version, true, ts.ScriptKind.TSX) : read(name, version, onError, fresh);
    const program = ts.createProgram([file], options, host);
    const callerFindings = inspectInputs(program, file, false);
    expect(callerFindings).toHaveLength(3);
    expect(callerFindings.filter((finding) => finding.startsWith("전체 상태"))).toHaveLength(2);
    const reusableFindings = inspectInputs(program, file);
    expect(reusableFindings.some((finding) => finding.includes("model: any"))).toBe(true);
    expect(reusableFindings.some((finding) => finding.includes("model: unknown"))).toBe(true);
    expect(reusableFindings.some((finding) => finding.includes("model: any[]"))).toBe(true);
    expect(reusableFindings.some((finding) => finding.includes("model: unknown[]"))).toBe(true);
  });
  it("타입 재수출의 제어기 우회도 일반 import와 같이 검사한다", () => {
    const file = path.join(uiRoot, "virtual-boundary.ts");
    const violations = inspectBoundarySource(file,
      'export type { VocabAssignmentPlannerController as Renamed } from "../controller/use-vocab-assignment-planner";',
      { root: uiRoot, allowModule: () => false });
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("forbidden-module");
  });
});
