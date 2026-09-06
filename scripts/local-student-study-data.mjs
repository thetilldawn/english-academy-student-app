// Synthetic, read-only localhost study fixtures. Never imported by application code.
import { createHmac } from "node:crypto";
const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const STUDY_TOKEN = "local-student-study-not-a-real-session";
export const STUDY_SECRET = "local-server-placeholder-not-a-real-key";
const tokenHash = createHmac("sha256", Buffer.alloc(32, 2)).update(STUDY_TOKEN).digest("hex").toUpperCase();
const modes = ["book_meaning_choice", "canonical_definition_to_headword", "canonical_example_to_headword"];
const labels = ["영어 → 뜻", "영영풀이 → 영어", "예문 → 영어"];
const stamp = "2026-09-06T00:00:00.000Z";
const samples = [
  ["collect", "모으다", "컬렉트", "to gather things", "She collected the letters.", "She _____ the letters."],
  ["go", "가다", "고", "to move to another place", "He went home.", "He _____ home."],
  ["look after", "돌보다", "룩 애프터", "to take care of someone", "They looked after the cat.", "They _____ the cat."],
  ["transparent", "투명한", "트랜스페어런트", "allowing light to pass through", "The glass is transparent.", "The glass is _____."],
  ["patient", "참을성 있는", "페이션트", "able to wait calmly", "She is patient with him.", "She is _____ with him."],
  ["enormous", "거대한", "이노머스", "very large in size", "They saw an enormous tree.", "They saw an _____ tree."],
  ["gentle", "온화한", "젠틀", "kind and calm", "A gentle breeze moved the leaves.", "A _____ breeze moved the leaves."],
  ["bright", "밝은", "브라이트", "giving a lot of light", "The room is bright.", "The room is _____."],
];
export const studyWords = samples.map(([headword, meaning, displayKo, definition, example], i) => ({
  entryId: 700 + i, headword, meaning, displayKo, definition, example,
  pronunciationSnapshot: null, dictionaryId: null, releaseId: null,
}));
export function studentStudyFixture({ target, method, headers, input }) {
  const deny = { status: 403, body: { error: "Local study read rejected" }, category: "rejected" };
  const ok = (body, category = "student-study") => ({ status: 200, body, category });
  if (target.origin !== "http://127.0.0.1:3038" || target.username || target.password ||
    headers.get("apikey") !== STUDY_SECRET || headers.get("authorization") !== "Bearer " + STUDY_SECRET) return deny;
  const table = target.pathname.replace("/rest/v1/", "");
  const query = target.searchParams;
  if (method === "GET") {
    if (table === "student_sessions" && query.get("token_hash") === "eq." + tokenHash) return ok({
      id: uid(888), student_id: uid(1), code_generation: 1,
      expires_at: "2030-01-01T00:00:00.000Z", last_seen_at: new Date().toISOString(), revoked_at: null,
      students: { id: uid(1), display_name: "로컬 가짜 학생", school_name: "검사 학교", grade_label: "고1", status: "active", code_generation: 1, deleted_at: null },
    }, "student-auth");
    if (table === "student_point_totals" && query.get("student_id") === "eq." + uid(1)) return ok({ total_points: 123 }, "points");
    if (["vocab_entry_pronunciations", "vocab_pronunciation_releases_v2"].includes(table)) return ok([], "study-pronunciation");
    if (table === "assignment_questions" && query.get("assignment_id") === "eq." + uid(23) &&
      query.get("eligibility_quiz_mode") === "eq.canonical_example_to_headword" &&
      query.get("select") === "vocab_entry_id,prompt" && query.get("limit") === "1001" &&
      query.get("vocab_entry_id") === "in.(" + studyWords.map(w => w.entryId).join(",") + ")") {
      return ok(samples.map((row, i) => ({ vocab_entry_id: 700 + i, prompt: row[5] })), "study-prompts");
    }
  }
  if (method === "POST" && table === "rpc/list_student_point_totals_v1" &&
    JSON.stringify(input?.p_student_ids) === JSON.stringify([uid(1)])) return ok([{ student_id: uid(1), current_points: 123 }], "points");
  if (method !== "POST" || input?.p_student_id !== uid(1)) return deny;
  if (table === "rpc/get_student_assignment_study_v1") {
    const index = [21, 22, 23].findIndex(n => uid(n) === input.p_assignment_id);
    return ok(index < 0 ? null : { assignmentId: input.p_assignment_id, title: "로컬 단어장 · " + labels[index], mode: modes[index], words: studyWords });
  }
  if (table === "rpc/get_student_dashboard_initial_v2") return ok([{
    completed_count: 0, completed_items: [], deadline_closed_count: 0, needs_attention_count: 0,
    open_count: 3, scheduled_count: 0, snapshot_at: stamp,
    current_items: [21, 22, 23].map((n, i) => ({
      assignmentId: uid(n), effectiveAt: stamp, dashboardSection: "open",
      item: { _dataset: { catalog: null, edition: null, title: "로컬 단어장 · " + labels[i] },
        id: uid(n), title: "로컬 단어장 · " + labels[i], assignedAt: stamp, assignmentPurpose: "regular", assignmentStatus: "active",
        availableFrom: null, availableUntil: null, lastAttemptId: null, lastCompletedAt: null,
        lastDeadlineAt: null, lastFinalScore: null, lastInitialCompletedAt: null, lastInitialScore: null,
        lastPassed: null, lastPhase: null, lastRetryStartedAt: null, lastStartedAt: null,
        lastStatus: null, lastUnresolvedWrongCount: null, missedAt: null, passingScore: 80,
        primaryUnitLabels: [], primaryUnitSortIndexes: [], questionCount: studyWords.length, retakeAllowed: false,
        unitLabels: [], unitSortIndexes: [] },
    })),
  }], "student-dashboard");
  return deny;
}
