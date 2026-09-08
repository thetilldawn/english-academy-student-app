import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createHmac } from "node:crypto";
import { STUDY_TOKEN, STUDY_SECRET, studyWords } from "../../scripts/local-student-study-data.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT, ACCESS_TOKEN, APP_ORIGIN, DATA_ORIGIN, PUBLIC_KEY, fixtureResponse, summarizeSamples, uid } from "../../scripts/local-admin-baseline-data.mjs";
import { assertLocalBaselineEnvironment, assertLocalFetchTarget, assertNestedPath, guardedFetch, waitForChild, stopOwnedChild, isRestorationSafe, assertMayStart, shouldSimulateCapacityFailure } from "../../scripts/local-admin-baseline-guard.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const env = { LOCAL_ADMIN_BASELINE: "fake-read-only-v1", APP_ORIGIN, NEXT_PUBLIC_SUPABASE_URL: DATA_ORIGIN,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY };
const read = (pathname, init = {}) => fixtureResponse({ url: DATA_ORIGIN + pathname, method: "GET",
  headers: new Headers({ apikey: PUBLIC_KEY, authorization: "Bearer " + ACCESS_TOKEN }), ...init });

describe("로컬 학생 학습 가짜 자료 보호", () => {
  const studyRead = (pathname, init = {}) => read(pathname, {
    headers: new Headers({ apikey: STUDY_SECRET, authorization: "Bearer " + STUDY_SECRET }), ...init,
  });
  it("특정 가짜 세션과 학생만 조회한다", () => {
    const hash = createHmac("sha256", Buffer.alloc(32, 2)).update(STUDY_TOKEN).digest("hex").toUpperCase();
    expect(studyRead("/rest/v1/student_sessions?token_hash=eq." + hash).status).toBe(200);
    expect(studyRead("/rest/v1/student_sessions?token_hash=eq.other").status).toBe(403);
    const rpc = "/rest/v1/rpc/get_student_assignment_study_v1";
    expect(studyRead(rpc, { method: "POST", body: JSON.stringify({ p_student_id: uid(1), p_assignment_id: uid(23) }) }).body.words).toHaveLength(8);
    expect(studyRead(rpc, { method: "POST", body: JSON.stringify({ p_student_id: uid(2), p_assignment_id: uid(23) }) }).status).toBe(403);
  });
  it("예문 위치 조회는 특정 배정·두 필드·상한만 허용한다", () => {
    const query = new URLSearchParams({ assignment_id: "eq." + uid(23), eligibility_quiz_mode: "eq.canonical_example_to_headword",
      select: "vocab_entry_id,prompt", limit: "1001", vocab_entry_id: "in.(" + studyWords.map(w => w.entryId).join(",") + ")" });
    expect(studyRead("/rest/v1/assignment_questions?" + query).status).toBe(200);
    query.set("select", "*");
    expect(studyRead("/rest/v1/assignment_questions?" + query).status).toBe(403);
  });
  it.each(["POST", "PATCH", "DELETE"])("가짜 서버도 %s 테이블 쓰기를 거절한다", method => {
    expect(studyRead("/rest/v1/student_sessions", { method }).status).toBe(403);
    expect(studyRead("/rest/v1/assignment_questions", { method }).status).toBe(403);
  });
  it("화면은 250ms 필터만 전환하고 감소 모션·공간 보존 계약을 지킨다", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/features/student-dashboard/ui/assignment-study.module.css"), "utf8");
    expect(css).toContain("transition: filter 250ms ease");
    expect(css).toContain("filter: blur(7px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("transition: none");
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden/u);
  });
});
describe("로컬 기준 계측 보호", () => {
  it("현재 준비 조회와 지정된 가짜 풀이 미리보기만 허용하고 저장은 닫아 둔다", () => {
    const availability = read("/rest/v1/rpc/list_assignment_question_mode_availability_v2", { method: "POST" });
    expect(availability.status).toBe(200);
    expect(availability.body[1].definition_count).toBe(100);
    const preview = "/rest/v1/rpc/list_active_canonical_question_preview_v1";
    const body = { p_dataset_id: uid(11), p_unit_ids: [uid(101), uid(105)], p_quiz_mode: "canonical_definition_to_headword" };
    expect(read(preview, { method: "POST", body: JSON.stringify(body) }).body).toHaveLength(40);
    expect(read(preview, { method: "POST", body: JSON.stringify({ ...body, p_unit_ids: [uid(1)] }) }).status).toBe(403);
    expect(read(preview, { method: "POST", body: JSON.stringify({ ...body, p_dataset_id: uid(333) }) }).status).toBe(403);
    expect(read("/rest/v1/rpc/create_bulk_assignments_v1", { method: "POST", body: JSON.stringify(body) }).status).toBe(403);
  });
  it("프로필 모드에서만 가짜 학생을 메모리에 저장하고 결과를 다시 읽는다", () => {
    const profile = { p_student_id: uid(1) };
    const request = { method: "POST", studentProfile: true, body: JSON.stringify(profile) };
    const get = "/rest/v1/rpc/get_admin_student_profile_v1";
    const update = "/rest/v1/rpc/update_admin_student_profile_v1";
    expect(read(get, { ...request, studentProfile: false }).status).toBe(403);
    const old = read(get, request).body;
    const body = JSON.stringify({ ...profile, p_base_version: old.updatedAt, p_display_name: old.displayName, p_school_name: old.schoolName, p_grade_label: old.gradeLabel });
    expect(read(update, { ...request, body, studentProfile: false }).status).toBe(403);
    const saved = read(update, { ...request, body });
    expect(saved.category).toBe("profile-memory-write");
    expect(read(get, request).body).toEqual(saved.body);
    expect(read(update, { ...request, body }).status).toBe(409);
    expect(read(get, { ...request, body: JSON.stringify({ p_student_id: uid(333) }) }).status).toBe(403);
  });
  it("용량 조회 오류는 명시한 로컬 미리보기에만 적용하고 배정 쓰기를 열지 않는다", () => {
    const preview = "/api/admin/bulk-assignments/preview";
    expect(shouldSimulateCapacityFailure(true, preview, "POST", APP_ORIGIN)).toBe(true);
    expect(shouldSimulateCapacityFailure(false, preview, "POST", APP_ORIGIN)).toBe(false);
    expect(shouldSimulateCapacityFailure(true, preview, "POST", "https://example.com")).toBe(false);
    expect(shouldSimulateCapacityFailure(true, preview, "GET", APP_ORIGIN)).toBe(false);
    expect(shouldSimulateCapacityFailure(true, "/api/admin/bulk-assignments", "POST", APP_ORIGIN)).toBe(false);
  });
  it("긴 범위 이름도 가짜 5범위·100개 안에서만 확인한다", () => {
    const result = read("/rest/v1/vocab_units?dataset_id=eq." + uid(10));
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(5);
    expect(result.body.reduce((sum, unit) => sum + unit.entry_count, 0)).toBe(100);
    expect(result.body.at(-1).unit_label).toBe("자이스토리 7회 29번 · 긴 범위 이름 확인");
    expect(read("/rest/v1/vocab_units?dataset_id=eq." + uid(123)).status).toBe(403);
  });
  it("부모가 먼저 비정상 종료하면 복구하지 않는다", async () => {
    expect(isRestorationSafe([{ kind: "build", exitCode: 1, signal: null }])).toBe(false);
    expect(isRestorationSafe([{ kind: "start", exitCode: 0, signal: null }])).toBe(false);
    expect(isRestorationSafe([{ kind: "build", exitCode: 0, signal: null }])).toBe(true);
    expect(isRestorationSafe([{ kind: "start", exitCode: null, signal: "SIGTERM", treeStopped: true }])).toBe(true);
    await expect(stopOwnedChild({ exitCode: 1, signalCode: null }, { spawn: vi.fn() })).rejects.toThrow("부모가 먼저 종료");
  });
  it("빌드 대기 중 종료 요청이 오면 다음 서버를 시작하지 않는다", async () => {
    let stopping = false;
    const start = vi.fn();
    const build = Promise.resolve(0);
    stopping = true;
    await build;
    expect(() => { assertMayStart(stopping); start(); }).toThrow("종료 요청 뒤");
    expect(start).not.toHaveBeenCalled();
  });
  it("로컬 응답도 자동 리다이렉트하지 않는다", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    await guardedFetch(fetch)(DATA_ORIGIN + "/x", { redirect: "follow" });
    expect(fetch).toHaveBeenCalledWith(DATA_ORIGIN + "/x", { redirect: "error" });
  });
  it("Windows 다른 드라이브와 상위/같은 경로는 거절한다", () => {
    for (const target of ["D:\\archive", "C:\\work", "C:\\", "C:\\other"]) {
      expect(() => assertNestedPath("C:\\work", target, path.win32)).toThrow();
    }
    expect(() => assertNestedPath("C:\\work", "C:\\work\\archive", path.win32)).not.toThrow();
  });
  it("프로세스 시작 실패를 호출자에게 전달한다", async () => {
    const child = new EventEmitter();
    const done = waitForChild(child);
    child.emit("error", new Error("spawn failed"));
    await expect(done).rejects.toThrow("spawn failed");
  });
  it("소유 PID의 하위 작업 종료와 직접 자식 종료를 둘 다 기다린다", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
    const killer = new EventEmitter(), spawn = vi.fn(() => killer), restored = vi.fn();
    const stopping = stopOwnedChild(child, { spawn, platform: "win32" }).then(restored);
    expect(spawn).toHaveBeenCalledWith("taskkill.exe", ["/PID", "123", "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.emit("exit", 0);
    await Promise.resolve();
    expect(restored).not.toHaveBeenCalled();
    child.emit("exit", 0);
    await stopping;
    expect(restored).toHaveBeenCalledOnce();
  });
  it("종료 확인 실패나 시간 초과 뒤에는 복구 단계로 넘어가지 않는다", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
    const killer = new EventEmitter(), restored = vi.fn();
    const stopping = stopOwnedChild(child, { spawn: () => killer, platform: "win32" }).then(restored);
    killer.emit("exit", 1);
    await expect(stopping).rejects.toThrow("종료 확인 실패");
    await expect(stopOwnedChild(child, { spawn: () => new EventEmitter(), platform: "win32", timeoutMs: 5 }).then(restored)).rejects.toThrow("시간 초과");
    expect(restored).not.toHaveBeenCalled();
  });
  it("시간 양식과 역순 학생 선택도 실제 읽기 계약을 따른다", () => {
    expect(read("/rest/v1/admin_vocab_assignment_time_templates")).toMatchObject({ status: 200, body: [] });
    expect(read("/rest/v1/students?id=in.(" + uid(2) + "," + uid(1) + ")").body).toHaveLength(2);
    expect(read("/rest/v1/students?id=in.(" + uid(3) + ")").status).toBe(403);
  });
  it("실제 환경 파일이나 호스팅/원격값이 있으면 시작하지 않는다", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-baseline-test-")); roots.push(root);
    expect(() => assertLocalBaselineEnvironment(env, root)).not.toThrow();
    for (const override of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { CI: "1" },
      { LOCAL_ADMIN_BASELINE: "" }, { APP_ORIGIN: "https://example.com" }, { NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }]) {
      expect(() => assertLocalBaselineEnvironment({ ...env, ...override }, root)).toThrow();
    }
    fs.writeFileSync(path.join(root, ".env.local"), "fake-only-test-marker");
    expect(() => assertLocalBaselineEnvironment(env, root)).toThrow();
  });
  it.each(["https://example.com/x", "http://127.0.0.1:3039/x", "http://localhost:3038/x",
    "http://name:password@127.0.0.1:3038/x", "file:///C:/secret"])("다른 연결 거절: %s", url => {
    expect(() => assertLocalFetchTarget(url)).toThrow();
  });
  it("가짜 로그인만 허용한다", () => {
    const input = { method: "POST", body: JSON.stringify(ACCOUNT) };
    expect(read("/auth/v1/token?grant_type=password", input).status).toBe(200);
    expect(read("/auth/v1/token?grant_type=password", { ...input, body: JSON.stringify({ email: "someone@example.invalid", password: ACCOUNT.password }) }).status).toBe(403);
    expect(read("/rest/v1/admin_profiles?user_id=eq." + uid(999)).status).toBe(200);
    expect(read("/rest/v1/admin_profiles?user_id=eq." + uid(1)).status).toBe(403);
  });
  it.each(["POST", "PATCH", "DELETE"])("%s 테이블 쓰기는 금지한다", method => {
    expect(read("/rest/v1/students", { method }).status).toBe(403);
  });
  it("알 수 없는 RPC·외부 origin·다른 계정 토큰은 거절한다", () => {
    expect(read("/rest/v1/rpc/delete_student_v2", { method: "POST" }).status).toBe(403);
    expect(read("/rest/v1/vocab_datasets", { url: "https://example.com/rest/v1/vocab_datasets" }).status).toBe(403);
    expect(read("/rest/v1/vocab_datasets", { headers: new Headers({ apikey: PUBLIC_KEY, authorization: "Bearer real-value-not-allowed" }) }).status).toBe(403);
  });
  it("정상 빈 결과와 모르는 요청을 구분한다", () => {
    const initial = read("/rest/v1/rpc/get_admin_student_directory_initial_v1", {
      method: "POST", body: JSON.stringify({ p_status: "all", p_wrong: "all", p_query: "", p_grade: "", p_school: "" }),
    });
    expect(initial.body[0].total_count).toBe(2);
    const result = read("/rest/v1/rpc/get_admin_student_directory_initial_v1", { method: "POST", body: JSON.stringify({ p_query: "없는 검색" }) });
    expect(result.status).toBe(200);
    expect(result.body[0]).toMatchObject({ total_count: 0, items: [] });
    expect(read("/rest/v1/not_registered").status).toBe(403);
  });
  it("표본을 변형하지 않고 중앙값/p95를 계산하고 부족한 표본은 거절한다", () => {
    const samples = [10, 2, 4, 6, 8, 1, 3, 5, 7, 9];
    expect(summarizeSamples(samples)).toEqual({ count: 10, median: 5.5, p95: 10 });
    expect(samples[0]).toBe(10);
    expect(() => summarizeSamples([1, 2])).toThrow();
    expect(() => summarizeSamples([...samples, NaN])).toThrow();
  });
});
