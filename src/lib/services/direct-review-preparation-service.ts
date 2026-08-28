import "server-only";

import type { AdminContext } from "@/lib/auth/admin";
import { requireAdmin } from "@/lib/auth/admin";
import {
  countReviewLevels,
  resolveReviewCandidate,
} from "@/lib/admin/review-candidate";
import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";
import type { DirectReviewCandidate } from "@/lib/admin/direct-review-candidate";
import { buildExactAssignmentQuestionPlan } from "@/lib/assignment/question-planner";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import { quizVocabularyIdentity } from "@/lib/quiz/word-identity";
import {
  DirectReviewCandidateError,
  listStudentDirectReviewCandidates,
} from "@/lib/services/direct-review-candidate-service";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_DIRECT_REVIEW_WORDS = 400;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type DatasetRow = {
  id: string;
  title: string;
  edition: string | null;
  status: string;
  is_active: boolean;
};

export class DirectReviewPreparationError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "unavailable"
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "오답 시험 후보를 준비하지 못했습니다.",
    public readonly fieldPath?: string,
  ) {
    super(message);
    this.name = "DirectReviewPreparationError";
  }
}

type DirectReviewSelection = {
  sourceQuestionIds: string[];
  reviewLevels: (1 | 2)[];
  wrongLevel1Eligible: number;
  wrongLevel2Eligible: number;
  questions: {
    vocab_entry_id: number;
    base_order_index: number;
    direction: "english_to_korean" | "korean_to_english";
    choice_vocab_entry_ids: number[];
  }[];
};

export function validateDirectReviewSelectionCount(
  expectedQuestionCount: number,
  selection: Pick<DirectReviewSelection, "sourceQuestionIds" | "questions">,
) {
  if (
    expectedQuestionCount !== selection.sourceQuestionIds.length ||
    expectedQuestionCount !== selection.questions.length
  ) {
    throw new DirectReviewPreparationError(
      "conflict",
      "오답 목록이 바뀌었습니다. 단어 수를 다시 확인해 주세요.",
    );
  }
}

export function buildDirectReviewSelection(
  input: DirectReviewPreviewInput,
  candidates: readonly DirectReviewCandidate[],
  allCandidates: readonly EligibleVocabularyEntry[],
): DirectReviewSelection {
  const selectedByIdentity = new Map<
    string,
    { candidate: DirectReviewCandidate; target: EligibleVocabularyEntry }
  >();

  for (const candidate of candidates) {
    if (
      candidate.datasetId !== input.datasetId ||
      !input.reviewLevels.includes(candidate.reasonLevel)
    ) {
      throw new DirectReviewPreparationError("conflict");
    }
    const target = resolveReviewCandidate(
      allCandidates,
      {
        vocabEntryId: candidate.vocabEntryId,
        canonicalDictionaryId: candidate.canonicalDictionaryId,
        canonicalLexemeId: candidate.canonicalLexemeId,
      },
      "dataset",
      new Set<string>(),
    );
    if (!target) {
      throw new DirectReviewPreparationError(
        "invalid_selection",
        "현재 오답 중 출제할 수 없는 단어가 있습니다.",
      );
    }
    if (
      (candidate.canonicalLexemeId !== null &&
        candidate.canonicalLexemeId !== target.canonicalLexemeId) ||
      (candidate.canonicalDictionaryId !== null &&
        candidate.canonicalDictionaryId !== target.canonicalDictionaryId)
    ) {
      throw new DirectReviewPreparationError(
        "conflict",
        "현재 오답의 단어 연결이 바뀌었습니다. 다시 계산해 주세요.",
      );
    }
    const identity = quizVocabularyIdentity(target);
    if (!selectedByIdentity.has(identity)) {
      selectedByIdentity.set(identity, { candidate, target });
    }
  }

  const selected = [...selectedByIdentity.values()].slice(
    0,
    MAX_DIRECT_REVIEW_WORDS,
  );
  if (selected.length === 0) {
    throw new DirectReviewPreparationError(
      "unavailable",
      "선택한 단계에 배정할 현재 오답이 없습니다.",
    );
  }

  let questionDrafts;
  try {
    questionDrafts = buildExactAssignmentQuestionPlan({
      targets: selected.map(({ target }) => target),
      allCandidates,
      englishToKoreanRatio: input.englishToKoreanRatio,
      randomSeed: [
        "direct-review",
        input.studentId,
        input.datasetId,
        ...selected.map(({ candidate }) => candidate.sourceQuestionId),
      ].join(":"),
    });
  } catch (error) {
    throw new DirectReviewPreparationError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : "현재 조건으로 오답 문제를 만들 수 없습니다.",
    );
  }

  const levelCounts = countReviewLevels(
    selected.map(({ candidate }) => candidate.reasonLevel),
  );
  return {
    sourceQuestionIds: selected.map(
      ({ candidate }) => candidate.sourceQuestionId,
    ),
    reviewLevels: [...input.reviewLevels].sort((left, right) => left - right),
    wrongLevel1Eligible: levelCounts.level1,
    wrongLevel2Eligible: levelCounts.level2,
    questions: questionDrafts.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      base_order_index: index + 1,
      direction: question.direction,
      choice_vocab_entry_ids: question.choiceVocabEntryIds,
    })),
  };
}

async function loadDirectReviewSelection(
  input: DirectReviewPreviewInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
) {
  const admin = authenticatedAdmin ?? await requireAdmin();
  const supabase = client ?? await createServerSupabaseClient();
  try {
    const [studentResult, datasetResult, allCandidates, candidates] =
      await Promise.all([
        supabase
          .from("students")
          .select("id, status")
          .eq("id", input.studentId)
          .maybeSingle(),
        supabase
          .from("vocab_datasets")
          .select("id, title, edition, status, is_active")
          .eq("id", input.datasetId)
          .maybeSingle(),
        loadEligibleVocabularyDataset(supabase, input.datasetId, {
          includeExamUseProjection: true,
        }),
        listStudentDirectReviewCandidates(
          {
            datasetId: input.datasetId,
            limit: MAX_DIRECT_REVIEW_WORDS,
            reviewLevels: input.reviewLevels,
            studentId: input.studentId,
          },
          admin,
          supabase,
        ),
      ]);
    if (studentResult.error || datasetResult.error) {
      throw new DirectReviewPreparationError("database");
    }
    const dataset = datasetResult.data as DatasetRow | null;
    if (
      !studentResult.data ||
      studentResult.data.status !== "active" ||
      !dataset ||
      dataset.status !== "ready" ||
      !dataset.is_active
    ) {
      throw new DirectReviewPreparationError("unavailable");
    }
    return {
      dataset,
      selection: buildDirectReviewSelection(input, candidates, allCandidates),
      supabase,
    };
  } catch (error) {
    if (error instanceof DirectReviewPreparationError) throw error;
    if (error instanceof DirectReviewCandidateError) {
      throw new DirectReviewPreparationError(error.reason, error.message);
    }
    throw new DirectReviewPreparationError("database");
  }
}

export async function calculateDirectReviewPreview(
  input: DirectReviewPreviewInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
) {
  const { selection } = await loadDirectReviewSelection(
    input,
    authenticatedAdmin,
    client,
  );
  return {
    wrongEligible: selection.questions.length,
    wrongLevel1Eligible: selection.wrongLevel1Eligible,
    wrongLevel2Eligible: selection.wrongLevel2Eligible,
  };
}

export async function prepareDirectReviewAssignmentBatch(
  input: DirectReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
  options?: { nowMilliseconds?: number },
) {
  const nowMilliseconds = options?.nowMilliseconds ?? Date.now();
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= nowMilliseconds
  ) {
    throw new DirectReviewPreparationError(
      "invalid_selection",
      "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
      "deadline",
    );
  }
  const { dataset, selection, supabase } = await loadDirectReviewSelection(
    input,
    authenticatedAdmin,
    client,
  );
  validateDirectReviewSelectionCount(input.totalQuestionCount, selection);
  let datasetLabel;
  try {
    datasetLabel = await loadDatasetDisplayLabel(supabase, dataset);
  } catch {
    throw new DirectReviewPreparationError("database");
  }
  return {
    studentId: input.studentId,
    datasetId: input.datasetId,
    reviewLevels: selection.reviewLevels,
    sourceQuestionIds: selection.sourceQuestionIds,
    title: (
      input.title ||
      `${datasetLabel} · 오답 시험 · ${selection.questions.length}문항`
    ).slice(0, MAX_ASSIGNMENT_TITLE_LENGTH).trimEnd(),
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    passingScore: input.passingScore,
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
    questionOrderMode: input.questionOrderMode,
    availableUntil: input.availableUntil,
    timingMode: input.timingMode ?? "total",
    questionTimeLimitSeconds:
      input.timingMode === "per_question"
        ? (input.questionTimeLimitSeconds ?? null)
        : null,
    questions: selection.questions,
  };
}
