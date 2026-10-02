import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { localMixedUiFixture } from "../../scripts/local-mistake-ui-data.mjs";
import { APP_ORIGIN, uid } from "../../scripts/local-admin-baseline-data.mjs";
import { mixedMistakePreviewSchema, mixedMistakeResultSchema } from "@/features/assignments/public-contracts";
import { localMistakeNotebookFixture, isLocalMistakeNotebookRead } from "../../scripts/local-mistake-notebook-data.mjs";
import { DATA_ORIGIN, PUBLIC_KEY, ACCESS_TOKEN } from "../../scripts/local-admin-baseline-data.mjs";
import { STUDY_SECRET } from "../../scripts/local-student-study-data.mjs";

const base = { planVersion: "meaning-episode-v1", studentId: uid(1), datasetId: uid(10), primaryUnitIds: [uid(101)],
  totalQuestionCount: 5, englishToKoreanRatio: 50, timingMode: "total", timeLimitSeconds: 60 };
const call = (body, save = false, overrides = {}) => localMixedUiFixture({
  path: "/api/admin/mixed-assignments" + (save ? "" : "/preview"), method: "POST", origin: APP_ORIGIN, body, ...overrides,
});

describe("가짜 현재·과거 오답장의 읽기 경계", () => {
  const read = (name, input, admin = false, overrides = {}) => localMistakeNotebookFixture({
    url: DATA_ORIGIN + "/rest/v1/rpc/" + name, method: "POST",
    headers: new Headers({ apikey: admin ? PUBLIC_KEY : STUDY_SECRET, authorization: "Bearer " + (admin ? ACCESS_TOKEN : STUDY_SECRET) }),
    body: JSON.stringify(input), ...overrides,
  });
  const request = { p_student_id: uid(1), p_filters: { view: "current" }, p_cursor: null };
  it("현재 뜻과 해결된 뜻을 구별하고 한 단어 카드로 반환한다", () => {
    const current = read("get_student_vocabulary_mistake_page_v1", request).body;
    const history = read("get_student_vocabulary_mistake_page_v1", { ...request, p_filters: { view: "history" } }).body;
    expect(current.items).toHaveLength(1); expect(history.items).toHaveLength(1);
    expect(current.items[0].meanings).toHaveLength(1); expect(history.items[0].meanings).toHaveLength(2);
    expect(current.items[0].lifetimeWrongCount).toBe(23); expect(history.items[0].lifetimeWrongCount).toBe(23);
    expect(current.items[0].cursor.count).toBe(2); expect(history.items[0].cursor.count).toBe(23);
    expect(history.items[0].meanings[1]).toMatchObject({ unresolved: false, currentWrongCount: 0 });
    expect(JSON.stringify(current)).not.toContain("sourceQuestionId");
    expect(read("get_admin_vocabulary_mistake_page_v1", request, true).body.items[0].meanings[0].sourceQuestionId).toBe(uid(701));
  });
  it("보기별 횟수로 필터하고 빈 결과의 합계도 비운다", () => {
    const page = filters => read("get_student_vocabulary_mistake_page_v1", { ...request, p_filters: filters }).body;
    expect(page({ view: "current", level: "once" }).totalCount).toBe(0);
    expect(page({ view: "current", minWrongCount: 3 }).totalCount).toBe(0);
    expect(page({ view: "history", minWrongCount: 23, maxWrongCount: 23 }).totalCount).toBe(1);
    expect(page({ view: "history", maxWrongCount: 22 }).totalCount).toBe(0);
    expect(page({ query: "없는 단어" }).summary).toMatchObject({ wordCount: 0, currentWrongCount: 0, lifetimeWrongCount: 0 });
  });
  it("같은 뜻의 이력은 20개 뒤 한 개를 중복 없이 잇는다", () => {
    const first = read("get_student_vocabulary_mistake_episodes_v1", { p_student_id: uid(1), p_meaning_key: "b".repeat(64), p_upper: "42", p_cursor: null }).body;
    const next = read("get_student_vocabulary_mistake_episodes_v1", { p_student_id: uid(1), p_meaning_key: "b".repeat(64), p_upper: "42", p_cursor: first.nextCursor }).body;
    expect(first.items).toHaveLength(20); expect(next.items).toHaveLength(1);
    expect(new Set([...first.items, ...next.items].map(item => item.episodeId)).size).toBe(21);
    expect(next.nextCursor).toBeNull();
    expect(read("get_student_vocabulary_mistake_episodes_v1", { p_student_id: uid(1), p_meaning_key: "b".repeat(64), p_upper: "42", p_cursor: { ...first.nextCursor, lastSequence: "24" } })).toMatchObject({status:403,body:{code:"42501"}});
  });
  it("다른 학생·다른 권한·다른 키는 읽을 수 없고 API 쓰기는 열지 않는다", () => {
    expect(read("get_student_vocabulary_mistake_page_v1", { ...request, p_student_id: uid(2) }).status).toBe(403);
    expect(read("get_admin_vocabulary_mistake_page_v1", request).status).toBe(403);
    expect(read("get_student_vocabulary_mistake_page_v1", { ...request, p_filters: { key: "unknown" } }).body.items).toEqual([]);
    expect(read("get_student_vocabulary_mistake_page_v1", request, false, { method: "DELETE" }).status).toBe(403);
    expect(isLocalMistakeNotebookRead("/api/student/notebook/episodes", "GET")).toBe(true);
    expect(isLocalMistakeNotebookRead("/api/student/notebook/episodes", "POST")).toBe(false);
    expect(isLocalMistakeNotebookRead(`/api/admin/students/${uid(2)}/wrong-words`, "GET")).toBe(false);
  });
});

describe("가짜 혼합 화면 검사의 경계", () => {
  it.each([4, 5, 6, 499, 500])("%i문항의 방향 수와 시험당 최소 시간을 실제 응답 계약에 맞춘다", count => {
    const result = call({ ...base, totalQuestionCount: count });
    const preview = mixedMistakePreviewSchema.parse(result.body);
    expect(preview.banks.map(bank => bank.timeLimitSeconds)).toEqual([30, 30]);
    expect(preview.banks.reduce((sum, bank) => sum + Math.round(bank.questionCount * bank.englishToKoreanRatio / 100), 0)).toBe(Math.round(count / 2));
  });
  it("시간이 부족하면 미완성 미리보기를 반환한다", () => {
    const preview = mixedMistakePreviewSchema.parse(call({ ...base, timeLimitSeconds: 30 }).body);
    expect(preview.error).toContain("60초");
    expect(preview.selectionFingerprint).toBeNull(); expect(preview.banks).toEqual([]);
  });
  it("다른 대상과 출처, 외부 Origin과 읽기 아닌 경로는 가짜 저장으로 받지 않는다", () => {
    for (const request of [{ studentId: uid(2) }, { datasetId: uid(99) }, { primaryUnitIds: [uid(99)] }, { planVersion: "legacy" }]) {
      expect(call({ ...base, ...request }).status).toBe(403);
    }
    expect(call(base, false, { origin: "https://example.invalid" }).status).toBe(403);
    expect(call(base, false, { method: "GET" }).status).toBe(403);
    expect(call(base, false, { path: "/api/admin/students" })).toBeNull();
  });
  it("응답 유실 뒤 같은 요청만 복구하고 다른 본문은 거절한다", () => {
    const preview = mixedMistakePreviewSchema.parse(call(base).body);
    const input = { ...base, idempotencyKey: randomUUID(), selectionFingerprint: preview.selectionFingerprint, excludeUnavailableConfirmed: true, banksConfirmed: true };
    expect(call(input, true).status).toBe(503);
    const saved = call(input, true);
    expect(saved.status).toBe(201);
    expect(mixedMistakeResultSchema.parse(saved.body).assignments).toHaveLength(2);
    const changed = { ...base, totalQuestionCount: 6 };
    const changedPreview = mixedMistakePreviewSchema.parse(call(changed).body);
    expect(call({ ...input, ...changed, selectionFingerprint: changedPreview.selectionFingerprint }, true).status).toBe(409);
  });
});
