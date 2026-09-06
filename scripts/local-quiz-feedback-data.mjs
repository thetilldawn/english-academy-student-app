// Opt-in, in-memory localhost fixtures. Never import from application code.
import { STUDY_SECRET } from "./local-student-study-data.mjs";
const uid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
export const LOCAL_QUIZ_AUDIO = "https://media.merriam-webster.com/audio/prons/en/us/mp3/l/localfixture.mp3";
export const localQuizCases = ["book_meaning_choice", "canonical_definition_to_headword", "canonical_example_to_headword"]
  .flatMap((mode, m) => ["initial", "retry"].map((phase, p) => ({ id: uid(201 + m * 2 + p), mode, phase })));
const states = new Map();
export const resetLocalQuizzes = () => states.clear();
const deny = { status: 403, body: { error: "Local quiz fixture rejected" }, category: "rejected" };
const ok = (body, category = "quiz-read") => ({ status: 200, body: structuredClone(body), category });
function stateFor(id) {
  const sample = localQuizCases.find(item => item.id === id);
  if (!sample) return null;
  if (!states.has(id)) {
    const pronunciation = { audioStatus: "raw_attached", listeningEnabled: true,
      pronunciationVariantId: "local:fixture", audioUrl: LOCAL_QUIZ_AUDIO, displayPronunciationKo: "로컬" };
    const words = ["collect", "patient", "gentle"];
    const meanings = ["모으다", "참을성 있는", "온화한"];
    const definitions = ["to gather things", "able to wait calmly", "kind and calm"];
    const examples = ["She _____ the letters.", "She is _____ with him.", "A _____ breeze moved the leaves."];
    const questions = words.map((word, i) => {
      const choices = sample.mode === "book_meaning_choice" ? [meanings[i], "닫다", "빠른", "낮은"] : [word, "close", "quick", "low"];
      return { id: uid(Number(id.slice(-3)) * 10 + i), vocab_entry_id: null, order_index: i + 1,
        direction: sample.mode === "book_meaning_choice" ? "english_to_korean" : "korean_to_english",
        prompt: sample.mode === "book_meaning_choice" ? word : sample.mode === "canonical_definition_to_headword" ? definitions[i] : examples[i],
        choices, correct_choice_index: 0, initial_choice_index: sample.phase === "retry" ? 1 : null,
        initial_is_correct: sample.phase === "retry" ? false : null, retry_choice_index: null, retry_is_correct: null,
        initial_timed_out: false, retry_timed_out: false, prior_wrong_count: 0,
        assignment_question: { headword_snapshot: word, primary_meaning_snapshot: meanings[i],
          provenance_status: "reviewed_for_preview_v1", choice_vocab_entry_ids: null,
          exam_use_snapshot: { headword_snapshot: word, primary_meaning_snapshot: meanings[i],
            provenance_status: "reviewed_for_preview_v1", display_pronunciation_ko_snapshot: "로컬",
            pronunciation_snapshot: pronunciation,
            choice_dictionary_snapshots: choices.map((displayHeadword, choiceIndex) => ({ displayHeadword, choiceIndex, ...pronunciation })) } },
      };
    });
    states.set(id, { ...sample, questions, index: 0, answers: new Map(), resumes: new Map(), startedAt: new Date().toISOString() });
  }
  return states.get(id);
}
export function localQuizSummary() {
  return [...states.values()].map(s => ({ id: s.id, mode: s.mode, phase: s.phase,
    answered: s.answers.size, resumed: s.resumes.size, currentQuestionId: s.questions[s.index]?.id ?? null }));
}
export function isLocalQuizRequest(pathname, method) {
  return localQuizCases.some(({ id }) => method === "GET"
    ? pathname === `/api/student/attempts/${id}`
    : method === "POST" && ["answers", "feedback"].some(action => pathname === `/api/student/attempts/${id}/${action}`));
}
export function studentQuizFixture({ target, method, headers, input }) {
  if (target.origin !== "http://127.0.0.1:3038" || target.username || target.password ||
    headers.get("apikey") !== STUDY_SECRET || headers.get("authorization") !== "Bearer " + STUDY_SECRET) return deny;
  const table = target.pathname.replace("/rest/v1/", "");
  const query = target.searchParams;
  if (["quiz_attempts", "assignments", "quiz_questions"].includes(table)) {
    if (method !== "GET") return deny;
    const id = query.get(table === "quiz_questions" ? "attempt_id" : "id");
    const s = id?.startsWith("eq.") ? stateFor(id.slice(3)) : null;
    if (!s) return deny;
    if (table === "quiz_attempts") {
      if (query.get("student_id") !== "eq." + uid(1)) return deny;
      return ok({ id: s.id, assignment_id: s.id, status: s.index < 3 ? "in_progress" : "completed", phase: s.phase,
        started_at: s.startedAt, deadline_at: "infinity", current_question_started_at: s.startedAt });
    }
    if (table === "assignments") return ok({ title: "로컬 음성 검사 · " + s.mode + " · " + s.phase,
      timing_mode: "none", question_time_limit_seconds: null, quiz_content_mode: s.mode });
    return ok(s.questions);
  }
  if (!["rpc/answer_quiz_question_v4", "rpc/resume_quiz_after_feedback_v2", "rpc/materialize_ready_vocab_assignment_queue_v1"].includes(table)) return null;
  if (method !== "POST" || input?.p_student_id !== uid(1)) return deny;
  if (table === "rpc/materialize_ready_vocab_assignment_queue_v1") return input.p_limit === 10 ? ok([], "quiz-queue") : deny;
  const s = stateFor(input.p_attempt_id);
  if (!s) return deny;
  if (table === "rpc/answer_quiz_question_v4") {
    if (input.p_phase !== s.phase || input.p_force_timeout !== false ||
      !Number.isInteger(input.p_choice_index) || input.p_choice_index < 0 || input.p_choice_index > 3) return deny;
    const existing = s.answers.get(input.p_question_id);
    if (existing) return existing.choice === input.p_choice_index ? ok(existing.result, "quiz-answer-repeat") : deny;
    const question = s.questions[s.index];
    if (!question || question.id !== input.p_question_id) return deny;
    question[s.phase + "_choice_index"] = input.p_choice_index;
    question[s.phase + "_is_correct"] = input.p_choice_index === 0;
    s.index += 1;
    const result = { correct: input.p_choice_index === 0, correctChoiceIndex: 0, completed: s.index === 3,
      nextQuestionId: s.questions[s.index]?.id ?? null, nextPhase: s.index < 3 ? s.phase : null, questionDeadlineAt: "infinity" };
    s.answers.set(question.id, { choice: input.p_choice_index, result });
    return ok(result, "quiz-answer");
  }
  if (input.p_next_phase !== s.phase || s.index === 0 || s.questions[s.index]?.id !== input.p_next_question_id ||
    !Number.isInteger(input.p_transition_remaining_milliseconds) || input.p_transition_remaining_milliseconds < 0 || input.p_transition_remaining_milliseconds > 750) return deny;
  if (!s.resumes.has(input.p_next_question_id)) s.resumes.set(input.p_next_question_id, {
    questionDeadlineAt: "infinity", questionStartsAt: new Date(Date.now() + input.p_transition_remaining_milliseconds).toISOString() });
  return ok(s.resumes.get(input.p_next_question_id), "quiz-resume");
}

// Quiet eight-second PCM tone: real media events, not synthesized play/ended events.
export function localQuizWave() {
  const rate = 16000, samples = rate * 8, data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(160 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return data;
}
