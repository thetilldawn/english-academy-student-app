import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { IMPACTS, POLICIES, TRACKING_FROM, UI_STATES } from "../../scripts/work-records/schema.mjs";
import { captureFingerprint, isImplementationPath, resolveRecordPath } from "../../scripts/work-records/evidence.mjs";
import { loadRecords } from "../../scripts/work-records/context.mjs";
import { registeredOwnerForPath } from "../../scripts/feature-map/ownership-catalog.mjs";
import { validateChangedCoverage, validateRecord } from "../../scripts/work-records/validation.mjs";

const appRoot = process.cwd();
describe("기존 공용 부품 검사 소유권", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(process.cwd(), "architecture/기능_소유권.json"), "utf8"));
  it("등록된 동명 로그아웃 부품 테스트는 인증 기능에 연결한다", () => {
    expect(registeredOwnerForPath(registry, "src/components/admin-logout-button.test.tsx")).toBe("auth");
  });
  it("원본이 없거나 다른 폴더면 추측하지 않는다", () => {
    expect(registeredOwnerForPath(registry, "src/components/missing.test.tsx")).toBeNull();
    expect(registeredOwnerForPath(registry, "src/components/nested/admin-logout-button.test.tsx")).toBeNull();
    expect(registeredOwnerForPath(registry, "src/components/admin-logout-button.test.ts")).toBe("auth");
  });
  it("유일한 공용 hook/계약 원본만 검사에 연결하고 모호한 원본은 거절한다", () => {
    expect(registeredOwnerForPath(registry, "src/components/use-route-exit-guard.test.tsx")).toBe("app-shell");
    expect(registeredOwnerForPath(registry, "src/lib/admin/history.test.ts")).toBe("history");
    expect(registeredOwnerForPath(registry, "src/lib/admin/unit-range-display.test.ts")).toBe("shared-contract");
    expect(registeredOwnerForPath(registry, "src/lib/admin/missing.test.ts")).toBeNull();
    const ambiguous = { ...registry, componentOwners: [...registry.componentOwners,
      { path: "src/components/use-route-exit-guard.tsx", owner: "other" }] };
    expect(registeredOwnerForPath(ambiguous, "src/components/use-route-exit-guard.test.tsx")).toBeNull();
  });
  it("정확한 기존 등록이 추론보다 우선한다", () => {
    const exact = { ...registry, componentOwners: [...registry.componentOwners,
      { path: "src/components/admin-logout-button.test.tsx", owner: "test-owner" }] };
    expect(registeredOwnerForPath(exact, "src/components/admin-logout-button.test.tsx")).toBe("test-owner");
  });
});
const folders = [];
const readExample = (name) => JSON.parse(fs.readFileSync(path.join(appRoot, "architecture/work-records/examples", name), "utf8"));
const small = () => readExample("작은_UI_수정.json");
const grammar = () => readExample("문법_기능_설계.json");

function write(root, file, content = "export const fixture = true;") {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture(record = small()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-record-test-"));
  folders.push(root);
  write(root, record.guide, "# 가상 예시 검토");
  for (const item of record.scope.filter((item) => item.state === "existing")) write(root, item.path);
  for (const item of record.uiStates) write(root, item.component);
  const context = {
    root, owners: ["example-ui"], featureOwners: ["example-ui"], flows: ["example-title"],
    ownerForPath: (file) => file.startsWith("src/features/example-ui/") ? "example-ui" : null,
    flowIdsForPath: (file) => file.startsWith("src/features/example-ui/") ? ["example-title"] : [],
    inputPaths: () => [],
  };
  return { record, context };
}

function seal(record, context) {
  record.verification = {
    ...captureFingerprint(record, context),
    runs: record.checks.map((check) => ({
      checkId: check.id, result: "pass", environment: "local", ranAt: "2026-09-05T01:00:00Z",
      command: "fixture only", summary: "검사기 분기 검사용 가상 결과. 실제 기능 검증이 아님.",
    })),
  };
  record.gate = "verified";
  return record;
}

function change(filePath, owners = ["example-ui"], flows = ["example-title"]) {
  return { filePath, mapped: { owners, flows } };
}

afterEach(() => {
  // Every path comes directly from mkdtemp above, never from a record or app data.
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

describe("작업 기록 v1 형식·설계", () => {
  it("작은 UI 예시는 영향과 오류 상태를 생략하지 않고 통과한다", () => {
    const { record, context } = fixture();
    expect(validateRecord(record, context, "design")).toEqual([]);
  });
  it("문법 기능은 실제 코드를 만들지 않고 예정 경로로 설계 검사만 통과한다", () => {
    const { record, context } = fixture(grammar());
    expect(validateRecord(record, context, "design")).toEqual([]);
    expect(fs.existsSync(path.join(context.root, record.scope[0].path))).toBe(false);
    expect(validateRecord(record, context, "complete").join()).toContain("예정 경로");
  });
  it.each([
    ["지원하지 않는 형식", (r) => { r.schemaVersion = 2; }],
    ["알 수 없는 상태", (r) => { r.gate = "approved"; }],
    ["알 수 없는 필드", (r) => { r.unknown = true; }],
    ["중복 요구 번호", (r) => { r.requirements.push(r.requirements[0]); }],
    ["중복 검사 번호", (r) => { r.checks.push(r.checks[0]); }],
    ["중복 경로", (r) => { r.scope.push(r.scope[0]); }],
    ["검사 계획 연결 없음", (r) => { r.requirements[0].checkIds = []; }],
    ["없는 검사 연결", (r) => { r.requirements[0].checkIds = ["missing"]; }],
    ["완료 조건 없음", (r) => { r.requirements[0].acceptance = " "; }],
    ["설계 항목 누락", (r) => { delete r.design.reuse; }],
    ["이유 없는 제외", (r) => { r.requirements[0].disposition = "excluded"; }],
    ["사용자 요구 임의 제외", (r) => { r.requirements[0].disposition = "excluded"; r.requirements[0].exclusion = { decisionId: "D1", reason: "내부 판단" }; r.decisions[0].owner = "engineering"; }],
    ["사용자 결정 근거 없음", (r) => { delete r.decisions[0].source; }],
    ["화면 상태 누락", (r) => { r.uiStates.pop(); }],
    ["오류 UI 검사 누락", (r) => { r.checks[0].topics = ["behavior"]; }],
  ])("%s 차단", (_label, mutate) => {
    const { record, context } = fixture();
    mutate(record);
    expect(validateRecord(record, context).length).toBeGreaterThan(0);
  });
  it.each(POLICIES)("문법 설계에서 %s 검사 누락을 차단한다", (topic) => {
    const { record, context } = fixture(grammar());
    record.policies[topic].checkIds = [];
    expect(validateRecord(record, context).join()).toContain(topic);
  });
  it.each(["authorization", "data-leak", "answer-leak"])("비공개 평가의 %s를 해당 없음으로 숨길 수 없다", (topic) => {
    const { record, context } = fixture(grammar());
    record.policies[topic].status = "not_applicable";
    expect(validateRecord(record, context).join()).toContain(topic);
  });
  it("명시한 사용자 결정에 따른 요구 제외는 허용한다", () => {
    const { record, context } = fixture();
    record.requirements[0].disposition = "excluded";
    record.requirements[0].exclusion = { decisionId: "D1", reason: "가상 사용자가 범위 제외 결정" };
    expect(validateRecord(record, context, "design")).toEqual([]);
  });
  it("미결정 기록 작성은 허용하되 기능 설계 관문은 차단한다", () => {
    const { record, context } = fixture();
    record.decisions[0].state = "open";
    expect(validateRecord(record, context, "format")).toEqual([]);
    expect(validateRecord(record, context, "design").join()).toContain("기능 전체");
  });
  it("검토 중인 draft는 구현 준비로 간주하지 않는다", () => {
    const { record, context } = fixture();
    record.gate = "draft";
    expect(validateRecord(record, context, "design").join()).toContain("draft");
  });
  it.each(["scope", "guide"])("존재한다고 선언한 %s 경로가 없으면 설계를 차단한다", (field) => {
    const { record, context } = fixture();
    if (field === "scope") record.scope[0].path = "src/features/example-ui/missing.tsx";
    else record.guide = "docs/missing.md";
    expect(validateRecord(record, context, "design").join()).toContain("현재 파일 없음");
  });
  it("모든 영향 항목에는 판단과 이유가 있다", () => {
    for (const record of [small(), grammar()]) expect(Object.keys(record.impacts)).toEqual(IMPACTS);
  });
});

describe("원요구 4번: 상태·쉬운 문구·복구 계획의 누락 방지", () => {
  it.each(UI_STATES)("%s 상태를 빠뜨리면 거절한다", (state) => {
    const { record, context } = fixture();
    record.uiStates = record.uiStates.filter((item) => item.state !== state);
    expect(validateRecord(record, context, "design").join()).toContain("화면 상태 누락: " + state);
  });
  it.each(["trigger", "message", "behavior", "recovery", "component", "checkIds"])("%s 기록 누락을 거절한다", (field) => {
    const { record, context } = fixture();
    delete record.uiStates[0][field];
    expect(validateRecord(record, context).join()).toContain(field);
  });
  it.each(["trigger", "message", "recovery"])("%s를 빈 문자열로 숨길 수 없다", (field) => {
    const { record, context } = fixture();
    record.uiStates[0][field] = "  ";
    expect(validateRecord(record, context).join()).toContain(field);
  });
  it("표시 검사만 연결하고 쉬운 문구 검사 주제를 빼면 거절한다", () => {
    const { record, context } = fixture();
    record.checks[0].topics = record.checks[0].topics.filter((topic) => topic !== "ui-copy");
    expect(validateRecord(record, context).join()).toContain("쉬운 안내 문구 검사 연결 누락");
  });
  it("문구 검사가 있어도 해당 상태의 T번호에 연결하지 않으면 거절한다", () => {
    const { record, context } = fixture();
    record.checks[0].topics = ["error-ui"];
    record.checks.push({ ...record.checks[0], id: "T-COPY", topics: ["ui-copy"] });
    expect(validateRecord(record, context).join()).toContain("쉬운 안내 문구 검사 연결 누락");
  });
  it("별도 문구 검사의 미실행은 완료로 인정하지 않는다", () => {
    const { record, context } = fixture();
    record.checks[0].topics = ["error-ui"];
    record.checks.push({ ...record.checks[0], id: "T-COPY", topics: ["ui-copy"] });
    record.uiStates.forEach((item) => item.checkIds.push("T-COPY"));
    expect(validateRecord(record, context, "design")).toEqual([]);
    seal(record, context);
    record.verification.runs.find((item) => item.checkId === "T-COPY").result = "not_run";
    expect(validateRecord(record, context, "complete").join()).toContain("T-COPY: 필수 검사가 통과하지");
  });
  it("안내 문구 변경에 과거 검사 결과를 재사용하지 못한다", () => {
    const { record, context } = fixture();
    seal(record, context);
    record.uiStates[0].message = "다른 안내 문구";
    expect(validateRecord(record, context, "complete").join()).toContain("지문");
  });
  it("문법 예시의 결정 범위는 작은 제목 수정 예시를 잘못 복사하지 않는다", () => {
    const decision = grammar().decisions.find((item) => item.id === "D1");
    expect(decision.answer).toContain("생성·배정·응시·조회·검색·수정·삭제·기록");
    expect(decision.answer).toContain("실제 구현 승인이 아님");
    expect(decision.answer).not.toContain("제목 표시만");
  });
  it.each(["작은_UI_수정.json", "문법_기능_설계.json"])("%s의 빈 결과·입력·404는 알맞은 실제 공용 부품을 예시로 쓴다", (name) => {
    const record = readExample(name);
    const states = Object.fromEntries(record.uiStates.map((item) => [item.state, item]));
    expect(states.empty.component).toBe("src/design-system/patterns/feedback/feedback.tsx");
    expect(states.unselected.component).toBe("src/design-system/primitives/form/field.tsx");
    expect(states["not-found"].component).toBe("src/app/not-found.tsx");
    expect(states.empty.trigger).toContain("최신 유효 요청 성공");
    expect(states.empty.recovery).toContain("이전 0건 뒤 새 검색 실패");
    expect(states["load-error"].recovery).toContain("빈 결과 동시 표시 금지");
    expect(states["save-error"].trigger).toContain("결과 불명확");
    for (const item of record.uiStates) expect(fs.existsSync(path.join(appRoot, item.component))).toBe(true);
  });
});

describe("완료 근거와 현재 코드", () => {
  it("현재 코드·검사에 대한 전체 통과 결과만 완료를 통과한다", () => {
    const { record, context } = fixture();
    seal(record, context);
    expect(validateRecord(record, context, "complete")).toEqual([]);
  });
  it.each(["fail", "skipped", "not_run"])("%s 결과는 필수 검사 통과가 아니다", (result) => {
    const { record, context } = fixture();
    seal(record, context).verification.runs[0].result = result;
    expect(validateRecord(record, context, "complete").join()).toContain("필수 검사가 통과하지");
  });
  it("실행 기록이 없는 필수 검사는 통과가 아니다", () => {
    const { record, context } = fixture();
    seal(record, context).verification.runs = [];
    expect(validateRecord(record, context, "complete").join()).toContain("필수 검사가 통과하지");
  });
  it.each(["source", "test", "config", "reused-ui", "design"])("%s 변경 후 과거 검사 근거 재사용 차단", (target) => {
    const { record, context } = fixture();
    seal(record, context);
    if (target === "design") record.requirements[0].acceptance += " 추가";
    else write(context.root, target === "source" ? record.scope[0].path : target === "test" ? record.checks[0].target : target === "reused-ui" ? record.uiStates[0].component : "next.config.ts", "changed");
    expect(validateRecord(record, context, "complete").join()).toContain("지문");
  });
  it("검증 기록 내용과 성숙도 변경은 재검사 순환을 만들지 않는다", () => {
    const { record, context } = fixture();
    seal(record, context);
    const prior = record.verification.fingerprint;
    record.verification.runs[0].summary += " 설명 보완";
    write(context.root, "architecture/work-records/records/EXAMPLE-SMALL.json", JSON.stringify(record));
    record.gate = "design";
    expect(captureFingerprint(record, context).fingerprint).toBe(prior);
    expect(validateRecord(record, context, "complete")).toEqual([]);
  });
  it("코드 파일 목록을 조작하면 해시 문자열이 같아도 차단한다", () => {
    const { record, context } = fixture();
    seal(record, context).verification.files.pop();
    expect(validateRecord(record, context, "complete").join()).toContain("지문");
  });
  it("Windows/CI 줄바꿈만 달라진 동일 코드는 v1 지문이 같다", () => {
    const { record, context } = fixture();
    write(context.root, record.scope[0].path, "export const value = 1;\r\n");
    const before = captureFingerprint(record, context).fingerprint;
    write(context.root, record.scope[0].path, "export const value = 1;\n");
    expect(captureFingerprint(record, context).fingerprint).toBe(before);
  });
  it("검증 기록은 제외하지만 검사가 읽는 예시 JSON은 해시에 포함한다", () => {
    const { record, context } = fixture();
    const file = "architecture/work-records/examples/fixture.json";
    context.inputPaths = () => [file];
    write(context.root, file, "{}");
    const before = captureFingerprint(record, context).fingerprint;
    write(context.root, file, '{"changed":true}');
    expect(captureFingerprint(record, context).fingerprint).not.toBe(before);
    expect(isImplementationPath("architecture/work-records/records/fixture.json")).toBe(false);
  });
  it("등록된 흐름 이름만 붙이고 실제 경로 연결이 없으면 완료 차단", () => {
    const { record, context } = fixture();
    context.flowIdsForPath = () => [];
    seal(record, context);
    expect(validateRecord(record, context, "complete").join()).toContain("실제 경로와 연결되지");
  });
  it("소유 지도와 실제 구현 소유자가 다르면 차단", () => {
    const { record, context } = fixture();
    context.ownerForPath = () => "someone-else";
    expect(validateRecord(record, context, "design").join()).toContain("실제 소유자");
  });
  it("완료 때 사라진 구현 경로를 확인한다", () => {
    const { record, context } = fixture();
    seal(record, context);
    fs.unlinkSync(path.join(context.root, record.scope[0].path));
    expect(validateRecord(record, context, "complete").join()).toContain("현재 파일 없음");
  });
});

describe("Git 변경의 기록 연결", () => {
  it("기록 없는 코드 변경을 차단하고 문서만 변경은 강제 소급하지 않는다", () => {
    const { context } = fixture();
    expect(validateChangedCoverage([change("src/new.ts")], [], context).join()).toContain("작업 기록 없는");
    expect(validateChangedCoverage([change("docs/old.md")], [], context)).toEqual([]);
  });
  it.each(["proxy.ts", "middleware.ts", "instrumentation.ts", "playwright.config.ts", "vercel.json", ".github/workflows/ci.yml", "public/logo.svg", "src/app/icon.svg", "src/app/fonts/font.woff2", "supabase/config.toml"])("%s 실행/설정 변경도 기록이 필요하다", (file) => {
    const { context } = fixture();
    expect(isImplementationPath(file)).toBe(true);
    expect(validateChangedCoverage([change(file)], [], context).length).toBeGreaterThan(0);
  });
  it("설계·소유·흐름이 연결된 변경 통과", () => {
    const { record, context } = fixture();
    expect(validateChangedCoverage([change(record.scope[0].path)], [record], context)).toEqual([]);
  });
  it("영향 흐름 일부만 적으면 차단", () => {
    const { record, context } = fixture();
    expect(validateChangedCoverage([change(record.scope[0].path, record.owners, ["example-title", "other"])], [record], context).length).toBeGreaterThan(0);
  });
  it("다른 기록을 붙여도 같은 기능의 미결정을 우회할 수 없다", () => {
    const { record, context } = fixture();
    const open = structuredClone(record);
    open.id = "OPEN";
    open.scope[0].path = "src/features/example-ui/another.tsx";
    open.scope[0].state = "planned";
    open.decisions[0].state = "open";
    expect(validateChangedCoverage([change(record.scope[0].path)], [record, open], context).join()).toContain("미결정 기능");
  });
  it("완료한 과거 기록은 같은 파일을 다시 변경하면 재사용할 수 없다", () => {
    const { record, context } = fixture();
    seal(record, context);
    expect(validateChangedCoverage([change(record.scope[0].path)], [record], context)).toEqual([]);
    write(context.root, record.scope[0].path, "new implementation");
    expect(validateChangedCoverage([change(record.scope[0].path)], [record], context).join()).toContain("현재 변경 근거 없음");
  });
  it("후속 작업에서 A를 삭제해도 과거 기록의 변경 없는 B는 소급 재검사를 요구하지 않는다", () => {
    const { record, context } = fixture();
    const [a, b] = record.scope;
    seal(record, context);
    const removal = small();
    removal.id = "DELETE-A";
    removal.scope = [{ ...a, state: "removed" }];
    fs.unlinkSync(path.join(context.root, a.path));
    expect(validateChangedCoverage([change(a.path), change(b.path)], [record, removal], context)).toEqual([]);
  });
  it("과거 기록의 요구를 고치고 파일 해시만 재사용해도 변경 검사는 거절한다", () => {
    const { record, context } = fixture();
    seal(record, context);
    record.requirements[0].acceptance += " 임의 변경";
    expect(validateChangedCoverage([change(record.scope[0].path)], [record], context).join()).toContain("지문");
  });
  it("잘못된 scope 자료는 예외 없이 형식 오류로 반환한다", () => {
    const { record, context } = fixture();
    record.scope = "invalid";
    expect(validateChangedCoverage([change("src/new.ts")], [record], context).length).toBeGreaterThan(0);
  });
  it("새 검사의 소급 시작점은 도입 전 커밋으로 고정한다", () => {
    expect(TRACKING_FROM).toBe("bc48313bc53840a44ab6505a8238eaabf7667eae");
  });
});

describe("경로·명령 경계", () => {
  it("기존 로컬 임시 시안만 lint/타입 대상에서 제외하고 앱 코드는 유지한다", () => {
    const lint = fs.readFileSync(path.join(appRoot, "eslint.config.mjs"), "utf8");
    const types = JSON.parse(fs.readFileSync(path.join(appRoot, "tsconfig.json"), "utf8"));
    expect(lint).toContain('".codex-tmp/**"');
    expect(types.exclude).toContain(".codex-tmp");
    expect(types.exclude).not.toContain("src");
    expect(isImplementationPath("src/app/page.tsx")).toBe(true);
  });
  it("CI는 새 검사 범위의 코드·자산을 생략하지 않고 전체 Git 이력을 받는다", () => {
    const ci = fs.readFileSync(path.join(appRoot, ".github/workflows/pr-fast.yml"), "utf8");
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("e2e/|public/");
    expect(ci).toContain("npm run verify:architecture");
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
    expect(pkg.scripts["verify:architecture:static"]).toContain("--phase design --changed");
    expect(pkg.scripts.prebuild).toContain("--phase format");
    expect(pkg.scripts.prebuild).not.toMatch(/--changed|--phase complete/);
  });
  it.each(["../outside.ts", "C:/outside.ts", "src/../../outside.ts", ".env.local", "node_modules/a.ts", ".git/config", "src\\bad.ts"])("안전하지 않은 경로 %s 차단", (file) => {
    const { record, context } = fixture();
    record.scope[0].path = file;
    expect(validateRecord(record, context).length).toBeGreaterThan(0);
    expect(() => resolveRecordPath(context.root, file)).toThrow();
  });
  it("앱 밖 디렉터리 링크로 검증 입력을 읽을 수 없다", () => {
    const { context } = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "work-record-outside-"));
    folders.push(outside);
    fs.symlinkSync(outside, path.join(context.root, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveRecordPath(context.root, "escape/file.ts")).toThrow("앱 밖");
  });
  it("실제 기록 폴더가 없으면 조용히 통과하지 않는다", () => {
    const { context } = fixture();
    expect(() => loadRecords(context.root)).toThrow("기록 폴더 없음");
  });
  it("Git과 앱 밖 작업 대장이 없어도 호스팅 형식 검사는 실행된다", () => {
    const { record, context } = fixture();
    const registry = JSON.parse(fs.readFileSync(path.join(appRoot, "architecture/기능_소유권.json"), "utf8"));
    registry.features.push({ id: "example-ui", ownerPath: "src/features/example-ui" });
    registry.crossLayerFlows.push({ id: "example-title" });
    write(context.root, "architecture/기능_소유권.json", JSON.stringify(registry));
    write(context.root, "architecture/work-records/records/EXAMPLE-SMALL.json", JSON.stringify(record));
    const result = spawnSync(process.execPath, [path.join(appRoot, "scripts/check-work-records.mjs"), "--phase", "format"], { cwd: context.root, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
  it.each([["--phase", "unknown"], ["--phase"], ["--unknown"], ["--phase", "complete"], ["--phase", "format", "--changed"]])("잘못된 명령 %j 차단", (...args) => {
    const result = spawnSync(process.execPath, [path.join(appRoot, "scripts/check-work-records.mjs"), ...args], { cwd: appRoot, encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});
