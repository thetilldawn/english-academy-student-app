// Synthetic HTTP fixtures only. Never import this module from application code.
import { studentStudyFixture, STUDY_SECRET } from "./local-student-study-data.mjs";
import { studentQuizFixture } from "./local-quiz-feedback-data.mjs";
export const APP_ORIGIN = "http://127.0.0.1:3037";
export const DATA_ORIGIN = "http://127.0.0.1:3038";
export const NEXT_ORIGIN = "http://127.0.0.1:3040";
export const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const ACCOUNT = { email: "local-baseline@example.invalid", password: "local-test-only-not-a-real-password" };
export const PUBLIC_KEY = "local-public-placeholder-not-a-real-key";
const base64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
export const ACCESS_TOKEN = [base64({ alg: "HS256", typ: "JWT" }), base64({
  sub: uid(999), aud: "authenticated", role: "authenticated", exp: 2100000000,
  iat: 1700000000, email: ACCOUNT.email, session_id: uid(998),
}), Buffer.from("local-only-no-valid-signature").toString("base64url")].join(".");
const user = { id: uid(999), aud: "authenticated", role: "authenticated",
  email: ACCOUNT.email, created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
const stamp = "2026-09-06T00:00:00.000Z";
export const students = [1, 2].map(n => ({
  id: uid(n), displayName: "가짜 학생 " + n, schoolName: "검사 학교", gradeLabel: "고1",
  currentVocabBook: null, codeStatus: "active", completedCount: 0, missedCount: 0,
  notStartedCount: 0, rawPoints: 0, recentExamAt: null, status: "active",
}));
export const datasets = [10, 11].map((n, index) => ({
  id: uid(n), dataset_key: "local-baseline-" + n, title: index === 0 ? "로컬 형용사" : "로컬 공통영어",
  edition: null, row_count: 100, status: "ready", is_active: true,
}));
export const catalogs = datasets.map((d, index) => ({
  dataset_id: d.id, display_name: d.title, catalog_group: "high", material_kind: "wordbook",
  grade_code: "H1", publisher: null, series_title: null, academic_year: null,
  curriculum_revision: null, edition_label: null, is_assignable: true, sort_index: index + 1,
}));
function parsedBody(body) {
  try { return body ? JSON.parse(body) : {}; } catch { return null; }
}
function requireFakeIds(body, ids) {
  const values = JSON.stringify(body).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/g) ?? [];
  return values.every(value => ids.includes(value));
}
function filteredStudents(input) {
  return students.filter(s => (!input.p_query || (s.displayName + " " + s.schoolName).includes(input.p_query)) &&
    (!input.p_grade || s.gradeLabel === input.p_grade) && (!input.p_school || s.schoolName === input.p_school) &&
    (!input.p_status || input.p_status === "all" || input.p_status === "active") &&
    (!input.p_wrong || input.p_wrong === "all") && !input.p_class_group_id && !input.p_wordbook);
}
const profileVersions = new Map();
export function fixtureResponse({ url, method, headers, body = "", quizFeedback = false, studentProfile = false }) {
  const target = new URL(url);
  const deny = { status: 403, body: { error: "Local fixture request rejected" }, category: "rejected" };
  if (target.origin !== DATA_ORIGIN || target.username || target.password) return deny;
  const input = parsedBody(body);
  if (headers.get("apikey") === STUDY_SECRET) {
    if (quizFeedback) {
      const quiz = studentQuizFixture({ target, method, headers, input });
      if (quiz) return quiz;
    }
    return studentStudyFixture({ target, method, headers, input });
  }
  if (input === null || !requireFakeIds(input, [uid(1), uid(2), uid(10), uid(11), ...[101, 102, 103, 104, 105].map(uid)])) return deny;
  if (headers.get("apikey") !== PUBLIC_KEY) return deny;
  const respond = (value, category) => ({ status: 200, body: value, category });
  if (target.pathname === "/auth/v1/token" && method === "POST") {
    if (input.email !== ACCOUNT.email || input.password !== ACCOUNT.password || target.searchParams.get("grant_type") !== "password") return deny;
    return respond({ access_token: ACCESS_TOKEN, refresh_token: "local-refresh-not-real",
      expires_in: 3600, expires_at: 2100000000, token_type: "bearer", user }, "auth");
  }
  if (headers.get("authorization") !== "Bearer " + ACCESS_TOKEN) return deny;
  if (target.pathname === "/auth/v1/user" && method === "GET") return respond(user, "auth");
  if (target.pathname === "/auth/v1/logout" && method === "POST") return respond({}, "auth");
  const table = target.pathname.replace("/rest/v1/", "");
  if (method === "GET") {
    if (table === "admin_profiles") {
      if (target.searchParams.get("user_id") !== "eq." + uid(999)) return deny;
      return respond({ display_name: "로컬 검사 관리자", is_active: true }, "auth-profile");
    }
    const id = target.searchParams.get("id");
    const datasetId = target.searchParams.get("dataset_id");
    if (id && !["eq." + uid(10), "eq." + uid(11), "in.(" + uid(1) + ")", "in.(" + uid(2) + ")", "in.(" + uid(1) + "," + uid(2) + ")", "in.(" + uid(2) + "," + uid(1) + ")"].includes(id)) return deny;
    if (datasetId && !["eq." + uid(10), "eq." + uid(11)].includes(datasetId)) return deny;
    if (table === "vocab_datasets") return respond(datasets.filter(d => !id || id === "eq." + d.id), "materials");
    if (table === "vocab_dataset_catalog") return respond(catalogs.filter(d => !datasetId || datasetId === "eq." + d.dataset_id), "materials");
    if (table === "students" && target.searchParams.get("select") === "id,student_point_totals(total_points)") {
      if (!id || target.searchParams.get("deleted_at") !== "is.null") return deny;
      return respond(students.filter(s => id.includes(s.id)).map(s => ({ id: s.id, student_point_totals: { total_points: s.rawPoints } })), "points");
    }
    if (table === "students") return respond(students.filter(s => !id || id.includes(s.id)).map(s => ({
      id: s.id, display_name: s.displayName, school_name: s.schoolName, grade_label: s.gradeLabel,
      current_vocab_book: null, current_vocab_dataset_id: null, status: "active",
    })), "preparation");
    if (table === "admin_vocab_assignment_time_templates") return respond([], "preparation");
    if (table === "vocab_units" && datasetId) return respond([1, 2, 3, 4, 5].map(n => ({
      id: uid(100 + n), dataset_id: datasetId.slice(3),
      unit_label: n === 5 ? "자이스토리 7회 29번 · 긴 범위 이름 확인" : "DAY " + n,
      unit_kind: "day", unit_number: n, sort_index: n, entry_count: 20,
    })), "units");
    if (table === "vocab_unit_catalog") return respond([], "units");
  }
  if (method === "POST" && table.startsWith("rpc/")) {
    const rpc = table.slice(4);
    if (studentProfile && ["get_admin_student_detail_initial_v2", "get_admin_student_profile_v1", "update_admin_student_profile_v1"].includes(rpc)) {
      const student = students.find(value => value.id === input.p_student_id);
      if (!student) return deny;
      if (rpc === "update_admin_student_profile_v1") {
        if (input.p_base_version !== (profileVersions.get(student.id) ?? stamp)) return { status: 409, category: "profile-conflict", body: { code: "40001", message: "student_profile_conflict" } };
        if (typeof input.p_display_name !== "string" || !input.p_display_name.trim() || input.p_display_name.length > 80 ||
          typeof input.p_school_name !== "string" || input.p_school_name.length > 120 || typeof input.p_grade_label !== "string" || input.p_grade_label.length > 40) return deny;
        Object.assign(student, { displayName: input.p_display_name.trim(), schoolName: input.p_school_name.trim() || null, gradeLabel: input.p_grade_label.trim() || null });
        profileVersions.set(student.id, new Date().toISOString());
      }
      const profile = { id: student.id, displayName: student.displayName, schoolName: student.schoolName, gradeLabel: student.gradeLabel, updatedAt: profileVersions.get(student.id) ?? stamp };
      if (rpc !== "get_admin_student_detail_initial_v2") return respond(profile, rpc.startsWith("update") ? "profile-memory-write" : "profile-result-read");
      return respond({ snapshotAt: new Date().toISOString(), student: { ...student, ...profile, createdAt: stamp, currentVocabDatasetId: null, readingContextSyncStatus: "not_configured", readingCurriculumStage: "undecided" },
        history: { items: [], totalCount: 0 }, learningSources: [], vocabBookHistory: [], wrongSummary: { wrongWordCount: 0, repeatedWrongWordCount: 0 } }, "student-detail");
    }
    if (rpc === "get_admin_history_initial_v1") {
      const keys = input.p_status_filter && input.p_status_filter !== "all" ? ["filter-" + input.p_status_filter]
        : ["open", "needs_attention", "completed", ...(input.p_current_only ? [] : ["archived"])];
      const items = students.filter(s => (!input.p_query || s.displayName.includes(input.p_query)) &&
        (!input.p_status_filter || ["all", "open"].includes(input.p_status_filter))).map(s => ({
        effectiveAt: stamp, entryKey: "assignment." + uid(20) + "." + s.id,
        item: { _dataset: { catalog: null, edition: null, title: "로컬 내역 단어장" },
          activityAt: stamp, assignedAt: stamp, assignmentId: uid(20), assignmentPurpose: "regular",
          assignmentTitle: "로컬 내역 시험", attemptId: null, availableUntil: null, cancelledAt: null,
          completedAt: null, datasetTitle: "로컬 내역 단어장", deadlineAt: null, finalScore: null,
          id: "assignment." + uid(20) + "." + s.id, initialCompletedAt: null, initialScore: null,
          missedAt: null, passed: null, passingScore: 80, phase: null, primaryUnitLabels: ["DAY 01"],
          questionCount: 20, retryStartedAt: null, startedAt: null, status: "not_started",
          studentId: s.id, studentName: s.displayName, schoolName: s.schoolName, gradeLabel: s.gradeLabel, unitLabels: ["DAY 01"] },
      }));
      return respond(keys.map(group_key => ({ group_key, items: ["open", "filter-open"].includes(group_key) ? items : [],
        snapshot_at: stamp, total_count: ["open", "filter-open"].includes(group_key) ? items.length : 0 })), "history");
    }
    if (rpc === "get_admin_student_directory_initial_v1") {
      const items = filteredStudents(input);
      return respond([{ filter_options: { classGroups: [], grades: ["고1"], schools: ["검사 학교"], wordbooks: [] },
        items: items.map(item => ({ item, sortAt: stamp, studentId: item.id })),
        snapshot_at: stamp, total_count: items.length }], "directory");
    }
    if (rpc === "list_admin_assignment_directory_selection_v1") return respond(
      filteredStudents(input).map(item => ({ item, student_id: item.id })), "selection");
    if (["list_assignment_question_mode_availability_v1", "list_assignment_question_mode_availability_v2"].includes(rpc)) return respond(
      datasets.map(d => ({ dataset_id: d.id, definition_count: d.id === uid(11) ? 100 : 0, reverse_definition_count: 0, example_count: 0 })), "preparation");
    if (rpc === "list_active_canonical_question_preview_v1") {
      if (input.p_dataset_id !== uid(11) || input.p_quiz_mode !== "canonical_definition_to_headword" ||
          !Array.isArray(input.p_unit_ids) || !input.p_unit_ids.length ||
          input.p_unit_ids.some(id => ![101, 102, 103, 104, 105].map(uid).includes(id))) return deny;
      return respond(input.p_unit_ids.flatMap((unitId) => Array.from({ length: 20 }, (_, index) => ({
        release_id: uid(500), package_sha256: "a".repeat(64), unit_id: unitId,
        vocab_entry_id: Number(unitId.slice(-3)) * 100 + index + 1, source_row: index + 1,
        question_item_id: unitId + "-" + index, question_item_sha256: "b".repeat(64),
      }))), "preview-read");
    }
    if (rpc === "get_admin_assignment_previous_exam_v1") return respond([], "previous-exam");
  }
  return deny;
}
export function summarizeSamples(values) {
  if (!Array.isArray(values) || values.length < 10 || values.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error("최소 10개의 유효 표본이 필요합니다.");
  }
  const sorted = [...values].sort((a, b) => a - b), midpoint = sorted.length / 2;
  return { count: sorted.length, median: sorted.length % 2 ? sorted[Math.floor(midpoint)] :
    (sorted[midpoint - 1] + sorted[midpoint]) / 2, p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}
