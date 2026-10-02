import "server-only";
import { hydrateQuizQuestions, type QuestionRow } from "@/lib/services/quiz/attempt-query";
import type { PracticeInput } from "../contracts/practice";
import type { QuizPronunciation } from "../model";
import { buildMistakePracticePlan, mistakePracticeSourceSchema } from "../domain/mistake-practice-plan";
import { practiceRpc, PracticeError } from "./practice-rpc";
import { freezePracticeQuestions, practiceHash } from "./practice-source";
import { getAttemptQuestionContents, type AttemptContentActor } from "./queries/question-content-query";

export async function prepareMistakePractice(studentId: string, input: PracticeInput) {
  const source = mistakePracticeSourceSchema.parse(await practiceRpc("prepare_student_word_practice_v1", { p_student_id: studentId, p_selection: input.selection }));
  const plan = buildMistakePracticePlan(source, input.settings, input.requestKey);
  const confirmation = plan.error ? null : practiceHash({ studentId, input, sourceHash: source.sourceHash, items: plan.items });
  return { source, plan, preview: { confirmation, availableCount: plan.availableCount, totalCount: plan.totalCount,
    words: plan.selected.map(word => ({ key: word.key, headword: word.headword, primaryMeaning: word.selectedText })), excluded: plan.excluded, error: plan.error } };
}

export async function freezeMistakePracticeQuestions(studentId: string,
  prepared: Pick<Awaited<ReturnType<typeof prepareMistakePractice>>, "source" | "plan">,
  actor: AttemptContentActor = { kind: "student", studentId }) {
  const primary = await freezePracticeQuestions({ source: prepared.source, plan: { candidates: prepared.plan.candidates,
    questions: prepared.plan.items.flatMap(item => item.generated ? [item.generated] : []) } }, actor.kind === "admin");
  const primaryByMeaning = new Map(primary.map(question => [question.wordKey, question]));
  const original = prepared.plan.items.filter(item => !item.generated);
  const bodies = new Map<string, Awaited<ReturnType<typeof getAttemptQuestionContents>> extends Map<string, infer T> ? T : never>();
  for (const attempt of new Set(original.map(item => item.word.sourceAttemptId))) {
    const values = await getAttemptQuestionContents(actor, attempt,
      original.filter(item => item.word.sourceAttemptId === attempt).map(item => item.word.sourceQuestionId));
    for (const [key, body] of values) bodies.set(key, body);
  }
  const frozen = new Map<string, { pronunciation: QuizPronunciation; choicePronunciations: QuizPronunciation[] }>();
  for (const mode of new Set(original.map(item => item.word.frozenQuestion.quizContentMode))) {
    const rows: QuestionRow[] = original.filter(item => item.word.frozenQuestion.quizContentMode === mode).map(({ word }, index) => {
      const q = word.frozenQuestion, body = bodies.get(word.sourceQuestionId)!;
      if (!body || body.prompt !== q.prompt || JSON.stringify(body.choices) !== JSON.stringify(q.choices)) throw new PracticeError(409, "문제 자료가 바뀌었습니다. 다시 확인해 주세요.", "source_changed");
      return { id: word.meaningKey, vocab_entry_id: word.latestVocabEntryId, order_index: index + 1, direction: q.direction, prompt: q.prompt,
        choices: q.choices, correct_choice_index: q.correctChoiceIndex, assignment_question: body.assignment_question,
        initial_choice_index: null, initial_is_correct: null, retry_choice_index: null, retry_is_correct: null, prior_wrong_count: 0 };
    });
    for (const question of await hydrateQuizQuestions(rows, mode, { preserveStudyPronunciation: actor.kind === "admin", strictPronunciation: true })) frozen.set(question.id, question);
  }
  return prepared.plan.items.map(({ word, generated }) => {
    const question = generated ? primaryByMeaning.get(word.meaningKey)! : { ...word.frozenQuestion, ...frozen.get(word.meaningKey)!, choiceSources: [] };
    // Only the small personal reference accompanies the shared question body.
    return { direction: question.direction, prompt: question.prompt, choices: question.choices, correctChoiceIndex: question.correctChoiceIndex,
      pronunciation: question.pronunciation, choicePronunciations: question.choicePronunciations, choiceSources: question.choiceSources,
      wordKey: word.wordKey, meaningKey: word.meaningKey, episodeId: word.episodeId, quizContentMode: word.frozenQuestion.quizContentMode,
      sourceQuestionId: word.sourceQuestionId, sourcePhase: word.sourcePhase, sourceContentHash: word.sourceContentHash };
  });
}
