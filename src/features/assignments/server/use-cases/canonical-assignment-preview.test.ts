import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminContext } from "@/lib/auth/admin";
import type { BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
const mocks = vi.hoisted(() => ({ load: vi.fn(), client: vi.fn(), count: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../queries/bulk-assignment-planning-query", () => ({ loadCommonBulkAssignmentPlanningData: mocks.load, loadSelectedVocabularyRowCount: mocks.count }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { resolveCanonicalBulkAssignmentPreview } from "./canonical-assignment-preview";

function request(): BulkAssignmentPreviewInput {
  return { questionMode: "canonical_example_to_headword", englishToKoreanRatio: 0, studentIds: ["fake-student"],
    commonPlan: { datasetId: "fake-book", planNonce: "fake-nonce", orderedUnitIds: ["fake-unit"], distribution: "repeat",
      splitBasis: "question_count", rangeUnitCounts: [], unitAllocationRule: null, questionCount: { mode: "all" },
      overflowPolicy: "leave", extraDatePolicy: "unconfirmed", selectedDateCount: 0, selectionMode: "source_order",
      sessions: [{ unitIds: ["fake-unit"], availableFrom: null, availableUntil: null }],
      recurrenceSessions: [{ availableFrom: null, availableUntil: null }] } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(null); mocks.load.mockRejectedValue(new Error("LOCAL_READ_BOUNDARY")); });
describe("예문도 공통 회차 규칙과 보이는 오류 위치를 사용한다", () => {
  function setup(splitBasis: "range_unit" | "question_count", dated: boolean) {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const units = [0, 1, 2].map(i => ({ id: id(100 + i), label: `DAY ${i + 1}`, sortIndex: i + 1 }));
    const input = request(); const count = dated ? 2 : 3;
    const slots = Array.from({ length: dated ? 2 : 1 }, (_, i) => ({ availableFrom: dated ? `2099-09-${14 + i}T00:00:00Z` : null, availableUntil: dated ? `2099-09-${14 + i}T13:00:00Z` : null }));
    input.commonPlan = { ...input.commonPlan, datasetId: id(10), orderedUnitIds: units.map(u => u.id), distribution: "split", splitBasis,
      selectedDateCount: dated ? 2 : 0, questionCount: splitBasis === "range_unit" ? { mode: "all" } : { mode: "manual", value: 4 },
      rangeUnitCounts: splitBasis === "range_unit" ? Array(dated ? 2 : 1).fill(1) : [],
      unitAllocationRule: splitBasis === "range_unit" ? { schemaVersion: 1, mode: "same", unitsPerSession: 1, weekdayUnitsPerSession: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } } : null,
      recurrenceSessions: slots,
      sessions: splitBasis === "range_unit" ? units.slice(0, count).map((u, i) => ({ unitIds: [u.id], ...slots[dated ? i : 0]! })) : slots.map(slot => ({ unitIds: units.map(u => u.id), ...slot })) };
    const planning = { dataset: { id: id(10), title: "가짜 예문", displayName: "가짜 예문", status: "ready", isActive: true, isAssignable: true }, students: [{ id: "fake-student", displayName: "가짜 학생", status: "active" }], units };
    const rows = Array.from({ length: 12 }, (_, n) => ({ release_id: id(20), package_sha256: "a".repeat(64), vocab_entry_id: n + 1, unit_id: units[Math.floor(n / 4)]!.id, source_row: n + 1, question_item_id: `example-${n}`, question_item_sha256: "b".repeat(64) }));
    mocks.load.mockResolvedValue(planning); mocks.client.mockResolvedValue({ rpc: vi.fn(async () => ({ data: rows, error: null })) });
    return { input, planning, rows };
  }
  it.each([["range_unit", false], ["range_unit", true], ["question_count", false], ["question_count", true]] as const)("%s 날짜%s의 예문 회차와 문항 합계", async (basis, dated) => {
    const { input } = setup(basis, dated);
    mocks.count.mockResolvedValue(111);
    const result = await resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext);
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith(input.commonPlan.datasetId, input.commonPlan.orderedUnitIds);
    expect(result.preview.items[0]!.countBreakdown).toEqual({ sourceCount: 111, outsideCandidateListCount: 99,
      activeReviewExcludedCount: 0, directionExcludedCount: 0, choiceExcludedCount: 0, allocationExcludedCount: 0, availableCount: 12 });
    expect(result.preview.items[0]!.uniqueScheduledQuestionCount).toBe(dated ? 8 : 12);
    expect(result.preview.items[0]).toMatchObject({ available: true, scheduledQuestionCount: dated ? 8 : 12, remainingQuestionCount: dated ? 4 : 0 });
    expect(result.preview.items[0]!.sessions.map(s => s.questionCount)).toEqual(Array(dated ? 2 : 3).fill(4));
    expect(result.preview.items[0]!.sessions.every(s => dated ? s.availableFrom !== null : s.availableFrom === null && s.availableUntil === null)).toBe(true);
    expect(new Set(result.canonicalPlansByStudent.get("fake-student")!.flat().map(q => q.id)).size).toBe(dated ? 8 : 12);
  });
  it.each(["range", "dataset", "students"] as const)("%s 오류를 숨은 단어수 입력으로 보내지 않는다", async field => {
    const { input, planning, rows } = setup("range_unit", false);
    if (field === "range") rows.pop();
    if (field === "dataset") planning.dataset.isAssignable = false;
    if (field === "students") planning.students[0]!.status = "disabled";
    expect((await resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext)).preview.items[0]).toMatchObject({ available: false, sessions: [], errorFieldKey: field });
  });
});
describe("reviewed mock exams share passage-session planning", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const sizes = [12,24,14,18,14,8,10,14,10,17,13,9,9,24,16,12,21,11,12,10];
  const modes = [["book_meaning_choice",100],["book_meaning_choice",0],
    ["canonical_definition_to_headword",0],["canonical_headword_to_definition",100]] as const;
  function setup(mode: typeof modes[number][0], ratio: 0 | 100) {
    const input = request();
    const units = sizes.map((entryCount, i) => ({ id:id(100+i), label:`가짜 지문 ${i+1}`, sortIndex:i+1, entryCount }));
    input.questionMode=mode; input.englishToKoreanRatio=ratio;
    input.commonPlan={...input.commonPlan,datasetId:id(10),distribution:"split",splitBasis:"range_unit",
      orderedUnitIds:units.map(u=>u.id),rangeUnitCounts:[1],
      unitAllocationRule:{schemaVersion:1,mode:"same",unitsPerSession:1,weekdayUnitsPerSession:{1:1,2:1,3:1,4:1,5:1,6:1,7:1}},
      sessions:units.map(u=>({unitIds:[u.id],availableFrom:null,availableUntil:null}))};
    mocks.load.mockResolvedValue({dataset:{id:id(10),title:"가짜 자료",displayName:"가짜 자료",status:"ready",isActive:true,isAssignable:true,questionBankKind:"reviewed_exam_v1"},
      students:[{id:"fake-student",displayName:"가짜 학생",status:"active"}],units});
    let sourceRow=0;
    const rows=units.flatMap(unit=>Array.from({length:unit.entryCount},()=>{
      const n=++sourceRow;
      const directions=mode==="book_meaning_choice" ? ["english_to_korean","korean_to_english"] : [ratio===100?"english_to_korean":"korean_to_english"];
      return directions.map(direction=>({release_id:id(12),package_sha256:"a".repeat(64),vocab_entry_id:n,
        unit_id:unit.id,source_row:n,question_item_id:`fake-${n}-${direction}`,question_item_sha256:"b".repeat(64),direction}));
    }).flat());
    const rpc=vi.fn(async()=>({error:null,data:rows})); mocks.client.mockResolvedValue({rpc});
    return {input,rows,rpc};
  }
  it.each(modes)("%s %i: 20 passages produce 20 undated sessions and 278 targets", async(mode,ratio)=>{
    const {input,rpc}=setup(mode,ratio);
    const result=await resolveCanonicalBulkAssignmentPreview(input,{} as AdminContext);
    const item=result.preview.items[0]!;
    expect(item.available,item.error ?? undefined).toBe(true);
    expect(item).toMatchObject({defaultSessionCount:20,totalAvailableQuestionCount:278,selectedQuestionCount:278,remainingQuestionCount:0});
    expect(item.sessions.map(s=>s.questionCount)).toEqual(sizes);
    expect(item.sessions.every(s=>s.availableFrom===null && s.availableUntil===null)).toBe(true);
    const questions=result.canonicalPlansByStudent.get("fake-student")!.flat();
    expect(new Set(questions.map(q=>q.id)).size).toBe(278);
    expect(questions.every(q=>q.bankSource==="reviewed_exam_v1" && q.direction===(ratio===100?"english_to_korean":"korean_to_english"))).toBe(true);
    expect(rpc).toHaveBeenCalledWith("list_active_reviewed_exam_questions_v1",expect.objectContaining({p_quiz_mode:mode}));
  });
  it("rejects a missing direction or mixed release, never falls back to unreviewed questions",async()=>{
    for(const invalid of ["missing-direction","mixed-release"]){
      const {input,rows}=setup("book_meaning_choice",100);
      if(invalid==="missing-direction") Reflect.deleteProperty(rows[0]!,"direction");
      else rows[0]!.release_id=id(13);
      await expect(resolveCanonicalBulkAssignmentPreview(input,{} as AdminContext)).rejects.toMatchObject({reason:"database"});
    }
  });
  it("rejects a forged passage allocation before producing a usable plan",async()=>{
    const {input}=setup("canonical_headword_to_definition",100);
    input.commonPlan.sessions[0]!.unitIds=[input.commonPlan.orderedUnitIds[1]!];
    const result=await resolveCanonicalBulkAssignmentPreview(input,{} as AdminContext);
    expect(result.preview.items[0]).toMatchObject({available:false,sessions:[]});
    expect(result.canonicalPlansByStudent.size).toBe(0);
  });
  it("source order follows the selected reverse passage range",async()=>{
    const {input}=setup("canonical_headword_to_definition",100);
    input.commonPlan.orderedUnitIds.reverse();
    input.commonPlan.splitBasis="question_count";input.commonPlan.distribution="repeat";
    input.commonPlan.questionCount={mode:"manual",value:4};
    input.commonPlan.sessions=[{unitIds:[...input.commonPlan.orderedUnitIds],availableFrom:null,availableUntil:null}];
    const result=await resolveCanonicalBulkAssignmentPreview(input,{} as AdminContext);
    expect(result.canonicalPlansByStudent.get("fake-student")?.[0]?.map(q=>q.id)).toEqual([269,270,271,272]);
  });
});

describe("canonical server restriction before data access", () => {
  it.each([[840, 4, 1, true], [844, 4, 1, false], [12, 4, 70, true], [12, 4, 71, false], [500, 500, 20, true], [500, 500, 21, false]] as const)(
    "무날짜 전체 %i개·회차당%i·학생%i명의 실제 확장 상한", async (total, perSession, studentCount, allowed) => {
      const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const input = request();
      input.questionMode = "canonical_definition_to_headword";
      input.studentIds = Array.from({ length: studentCount }, (_, i) => uuid(100 + i));
      input.commonPlan = { ...input.commonPlan, datasetId: uuid(10), orderedUnitIds: [uuid(11)], distribution: "split",
        questionCount: { mode: "manual", value: perSession }, sessions: [{ unitIds: [uuid(11)], availableFrom: null, availableUntil: null }] };
      mocks.load.mockResolvedValue({ dataset: { id: uuid(10), title: "가짜 자료", displayName: "가짜 자료", status: "ready", isActive: true, isAssignable: true },
        students: input.studentIds.map(id => ({ id, displayName: "가짜 학생", status: "active" })),
        units: [{ id: uuid(11), label: "DAY 1", sortIndex: 1 }] });
      mocks.client.mockResolvedValue({ rpc: vi.fn(async () => ({ error: null, data: Array.from({ length: total }, (_, n) => ({
        release_id: uuid(12), package_sha256: "a".repeat(64), vocab_entry_id: n + 1, unit_id: uuid(11), source_row: n + 1,
        question_item_id: `fake-${n}`, question_item_sha256: "b".repeat(64),
      })) })) });
      const result = await resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext);
      expect(result.preview.items.every(item => item.available === allowed)).toBe(true);
      if (allowed) {
        expect(result.preview.assignmentCount).toBe(total / perSession * studentCount);
        expect(result.preview.items.every(item => item.scheduledQuestionCount === total && item.remainingQuestionCount === 0)).toBe(true);
        expect(result.preview.items.flatMap(item => item.sessions).every(session => session.availableFrom === null && session.availableUntil === null)).toBe(true);
      } else expect(result.canonicalPlansByStudent.size).toBe(0);
    });
  it.each(["canonical_definition_to_headword", "canonical_example_to_headword"] as const)("%s의 전체 후보601과 회차500 상한을 구분한다", async questionMode => {
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const input = request();
    input.questionMode = questionMode;
    input.commonPlan.datasetId = uuid(10);
    input.commonPlan.orderedUnitIds = [uuid(11)];
    input.commonPlan.sessions[0]!.unitIds = [uuid(11)];
    mocks.load.mockResolvedValue({
      dataset: { id: uuid(10), title: "가짜 자료", displayName: "가짜 자료", status: "ready", isActive: true, isAssignable: true },
      students: [{ id: "fake-student", displayName: "가짜 학생", status: "active" }],
      units: [{ id: uuid(11), label: "DAY 1", sortIndex: 1 }],
    });
    mocks.client.mockResolvedValue({ rpc: vi.fn(async () => ({ error: null, data: Array.from({ length: 601 }, (_, n) => ({
      release_id: uuid(12), package_sha256: "a".repeat(64), vocab_entry_id: n + 1,
      unit_id: uuid(11), source_row: n + 1, question_item_id: `fake-item-${n}`, question_item_sha256: "b".repeat(64),
    })) })) });
    const result = await resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext);
    expect(result.preview.items[0]).toMatchObject({
      available: true, totalAvailableQuestionCount: 601, maximumSessionQuestionCount: 500,
      selectedQuestionCount: 500, remainingQuestionCount: 101,
    });
    expect(result.canonicalPlansByStudent.get("fake-student")?.[0]).toHaveLength(500);
    input.commonPlan.questionCount = { mode: "manual", value: 501 };
    const rejected = await resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext);
    expect(rejected.preview.items[0]).toMatchObject({ available: false, errorFieldKey: "questionCount" });
  });
  it("rejects example direction mismatch before any query", async () => {
    const input = request(); input.englishToKoreanRatio = 50;
    await expect(resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext)).rejects.toMatchObject({ reason: "invalid_selection" });
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each(["canonical_definition_to_headword", "canonical_example_to_headword"] as const)("allows valid %s through the unchanged read boundary", async mode => {
    const input = request(); input.questionMode = mode;
    await expect(resolveCanonicalBulkAssignmentPreview(input, {} as AdminContext)).rejects.toThrow("LOCAL_READ_BOUNDARY");
    expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.client).not.toHaveBeenCalled();
  });
});
