import "server-only";

import {
  createQuizQuestions,
  type QuizVocabularyEntry,
} from "@/lib/quiz/engine";
import {
  assignmentDisplayTitleForUnits,
  assignmentScopeLabel,
  type AssignmentPurpose,
} from "@/lib/admin/history";
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
import { deriveAttemptQuestionMetrics } from "@/lib/quiz/result-presentation";
import {
  approvedKoreanPronunciationKey,
  mergeKoreanPronunciationRegistries,
  parseChoicePronunciations,
  parseChoiceDictionaryIds,
  parseApprovedKoreanPronunciation,
  parseRuleDerivedKoreanPronunciation,
  parseRegistryPronunciation,
  parseSyntheticRegistryPronunciation,
  syntheticAudioProfilePriority,
  sortSyntheticAudioBindingsByProfilePriority,
  parseTargetPronunciation,
  parseVocabPronunciationIdentityV2,
  preferredPronunciationWithActiveVocaRelease,
  syntheticPronunciationBindingKey,
  unavailablePronunciation,
  withPronunciationDisplay,
  type QuizPronunciation,
  type VocabApprovedKoreanPronunciationRow,
  type VocabPronunciationRegistryRow,
  type VocabPronunciationIdentityV2Row,
  type VocabRuleDerivedKoreanPronunciationRow,
  type VocabSyntheticAudioAssetRow,
} from "@/lib/quiz/pronunciation-snapshot";
import {
  isTrustedQuestionSnapshot,
  type QuestionProvenanceStatus,
} from "@/lib/quiz/question-provenance";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import type { StudentAssignmentSummary } from "@/features/student-dashboard/model";
import type {
  AttemptResultQuestion,
  StudentAttemptResult,
} from "@/features/results/model";
import { loadDatasetDisplayLabelMap } from "@/lib/services/dataset-catalog-service";
import { finalizeStudentMissedAssignments } from "@/lib/services/missed-assignment-service";
import { finalizeStaleQuizAttempts } from "@/lib/services/stale-attempt-service";

export type { StudentAssignmentSummary } from "@/features/student-dashboard/model";

export type AttemptQuestionState = {
  id: string;
  orderIndex: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  pronunciation: QuizPronunciation;
  choicePronunciations: QuizPronunciation[];
  initialChoiceIndex: number | null;
  initialIsCorrect: boolean | null;
  retryChoiceIndex: number | null;
  retryIsCorrect: boolean | null;
  priorWrongLevel: 0 | 1 | 2;
  initialTimedOut: boolean;
  retryTimedOut: boolean;
  revealedCorrectChoiceIndex: number | null;
};

export type AttemptState = {
  id: string;
  assignmentTitle: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  startedAt: string;
  deadlineAt: string;
  timerDeadlineAt: string;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  questions: AttemptQuestionState[];
  currentQuestionId: string | null;
};

export type AttemptQuestionResult = AttemptResultQuestion;

export function completeChoiceVocabEntryIds(
  value: unknown,
  choiceCount: number,
): Array<number | null> {
  if (
    !Array.isArray(value) ||
    value.length !== choiceCount ||
    !value.every(
      (item) => typeof item === "number" && Number.isSafeInteger(item),
    )
  ) {
    return Array.from({ length: choiceCount }, () => null);
  }
  return value;
}

type AssignmentRow = {
  id: string;
  title: string;
  assignment_purpose: AssignmentPurpose;
  dataset_id: string;
  range_start: number;
  range_end: number;
  question_count: number;
  english_to_korean_ratio: number;
  time_limit_seconds: number;
  passing_score: number;
  retake_allowed: boolean;
  range_basis: "source_rows" | "units";
  question_bank_version: number | null;
  question_order_mode: QuestionOrderMode;
  timing_mode: TimingMode;
  question_time_limit_seconds: number | null;
  status: "draft" | "active" | "closed";
  available_from: string | null;
  available_until: string | null;
};

type AttemptRow = {
  id: string;
  assignment_id: string;
  status: "in_progress" | "completed" | "expired";
  phase: "initial" | "review" | "retry" | "completed";
  attempt_number: number;
  started_at: string;
  initial_completed_at: string | null;
  deadline_at: string;
  completed_at: string | null;
  unresolved_wrong_count: number | null;
  current_question_started_at: string;
  initial_score: number | string | null;
  final_score: number | string | null;
  passed: boolean | null;
  retry_started_at: string | null;
};

type QuestionRow = {
  id: string;
  vocab_entry_id: number | null;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  prior_wrong_count: number;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
};

type AssignmentQuestionSnapshot = {
  vocab_entry_id?: number;
  choice_vocab_entry_ids?: number[] | null;
  headword_snapshot: string | null;
  primary_meaning_snapshot: string | null;
  provenance_status: QuestionProvenanceStatus;
  exam_use_snapshot?:
    | ExamUseQuestionSnapshot
    | ExamUseQuestionSnapshot[]
    | null;
};

async function loadVocabPronunciationRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, QuizPronunciation>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(vocabEntryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_entry_pronunciations")
      .select(
        "vocab_entry_id, provider, status, review_status, listening_enabled, selected_variant_id, selected_audio_url, variants",
      )
      .in("vocab_entry_id", chunk)
      .eq("listening_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] registry lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabPronunciationRegistryRow[]) {
      const pronunciation = parseRegistryPronunciation(row);
      if (pronunciation.available) {
        result.set(row.vocab_entry_id, pronunciation);
      }
    }
  }
  return result;
}

async function loadActiveVocabPronunciationReleaseRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, QuizPronunciation>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const uniqueIds = [...new Set(vocabEntryIds)];
  const { data: releaseData, error: releaseError } = await supabase
    .from("vocab_pronunciation_releases_v2")
    .select("release_id")
    .eq("status", "active");
  if (releaseError) {
    console.warn("[quiz-pronunciation] active VOCA release lookup failed", {
      code: releaseError.code,
    });
    return result;
  }
  const activeReleaseIds = [
    ...new Set(
      (releaseData ?? []).flatMap((row) =>
        typeof row.release_id === "string" ? [row.release_id] : [],
      ),
    ),
  ];
  if (activeReleaseIds.length === 0) return result;
  const bindings: Array<{
    release_id: string;
    vocab_entry_id: number;
    identity_id: string;
  }> = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const chunk = uniqueIds.slice(offset, offset + 400);
    const { data, error } = await supabase
      .from("vocab_entry_pronunciation_bindings_v2")
      .select("release_id, vocab_entry_id, identity_id")
      .in("vocab_entry_id", chunk)
      .in("release_id", activeReleaseIds)
      .eq("is_entry_default", true);
    if (error) {
      console.warn("[quiz-pronunciation] active VOCA binding lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of data ?? []) {
      if (
        typeof row.release_id === "string" &&
        typeof row.vocab_entry_id === "number" &&
        uniqueIds.includes(row.vocab_entry_id) &&
        typeof row.identity_id === "string"
      ) {
        bindings.push({
          release_id: row.release_id,
          vocab_entry_id: row.vocab_entry_id,
          identity_id: row.identity_id,
        });
      }
    }
  }
  const identityIds = [
    ...new Set(bindings.map(({ identity_id }) => identity_id)),
  ];
  const pronunciationsByIdentity = new Map<string, QuizPronunciation>();
  for (let offset = 0; offset < identityIds.length; offset += 80) {
    const chunk = identityIds.slice(offset, offset + 80);
    const { data, error } = await supabase
      .from("vocab_pronunciation_identities_v2")
      .select(
        "identity_id, pronunciation_variant_id, audio_provider, official_audio_url, sound_audio, storage_bucket, storage_object_key, audio_sha256, byte_count, profile_id, request_sha256, model, voice, display_pronunciation_ko, segments, engine_version, playback_enabled, display_enabled, identity_content_sha256",
      )
      .in("identity_id", chunk)
      .eq("playback_enabled", true)
      .eq("display_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] active VOCA identity lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabPronunciationIdentityV2Row[]) {
      const pronunciation = parseVocabPronunciationIdentityV2(row, supabaseUrl);
      if (pronunciation && typeof row.identity_id === "string") {
        pronunciationsByIdentity.set(row.identity_id, pronunciation);
      }
    }
  }
  for (const binding of bindings) {
    const pronunciation = pronunciationsByIdentity.get(binding.identity_id);
    if (pronunciation) result.set(binding.vocab_entry_id, pronunciation);
  }
  return result;
}

async function loadVocabPronunciationDisplayRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, string>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(vocabEntryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_entries")
      .select("id, pronunciation_ko")
      .in("id", chunk);
    if (error) {
      console.warn("[quiz-pronunciation] display lookup failed", {
        code: error.code,
      });
      return new Map<number, string>();
    }
    for (const row of data ?? []) {
      if (
        typeof row.id === "number" &&
        typeof row.pronunciation_ko === "string" &&
        row.pronunciation_ko.trim()
      ) {
        result.set(row.id, row.pronunciation_ko.trim());
      }
    }
  }
  return result;
}

async function loadSyntheticPronunciationRegistry(
  bindings: readonly { releaseId: string; vocabEntryId: number }[],
) {
  const result = new Map<string, QuizPronunciation>();
  if (bindings.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const vocabIdsByRelease = new Map<string, Set<number>>();
  for (const { releaseId, vocabEntryId } of bindings) {
    const ids = vocabIdsByRelease.get(releaseId) ?? new Set<number>();
    ids.add(vocabEntryId);
    vocabIdsByRelease.set(releaseId, ids);
  }
  const acceptedBindings: Array<{
    release_id: string;
    vocab_entry_id: number;
    asset_id: string;
  }> = [];
  const bindingChunkSize = 400;
  for (const [releaseId, ids] of vocabIdsByRelease) {
    const vocabEntryIds = [...ids];
    for (
      let offset = 0;
      offset < vocabEntryIds.length;
      offset += bindingChunkSize
    ) {
      const chunk = vocabEntryIds.slice(offset, offset + bindingChunkSize);
      const { data: bindingData, error: bindingError } = await supabase
        .from("vocab_synthetic_audio_bindings")
        .select("release_id, vocab_entry_id, asset_id")
        .eq("release_id", releaseId)
        .in("vocab_entry_id", chunk);
      if (bindingError) {
        console.warn("[quiz-pronunciation] synthetic binding lookup failed", {
          code: bindingError.code,
        });
        return new Map<string, QuizPronunciation>();
      }
      for (const row of bindingData ?? []) {
        if (
          row.release_id === releaseId &&
          typeof row.vocab_entry_id === "number" &&
          ids.has(row.vocab_entry_id) &&
          typeof row.asset_id === "string"
        ) {
          acceptedBindings.push({
            release_id: row.release_id,
            vocab_entry_id: row.vocab_entry_id,
            asset_id: row.asset_id,
          });
        }
      }
    }
  }
  const assetIds = [
    ...new Set(acceptedBindings.map((binding) => binding.asset_id)),
  ];
  if (assetIds.length === 0) return result;
  const assetData: VocabSyntheticAudioAssetRow[] = [];
  const assetChunkSize = 80;
  for (let offset = 0; offset < assetIds.length; offset += assetChunkSize) {
    const chunk = assetIds.slice(offset, offset + assetChunkSize);
    const { data, error: assetError } = await supabase
      .from("vocab_synthetic_audio_assets")
      .select(
        "asset_id, dictionary_id, speech_text, profile_id, provider, model, voice, pronunciation_variant_id, pronunciation_identity_type, pronunciation_mode, canonical_ipa, google_tts_ipa, request_sha256, storage_bucket, storage_object_key, review_status, storage_verified, playback_enabled, canonical_pronunciation_approval_implied",
      )
      .in("asset_id", chunk)
      .eq("playback_enabled", true);
    if (assetError) {
      console.warn("[quiz-pronunciation] synthetic asset lookup failed", {
        code: assetError.code,
      });
      return new Map<string, QuizPronunciation>();
    }
    assetData.push(...((data ?? []) as VocabSyntheticAudioAssetRow[]));
  }
  const pronunciationByAsset = new Map<string, QuizPronunciation>();
  const priorityByAsset = new Map<string, number>();
  for (const row of assetData) {
    const pronunciation = parseSyntheticRegistryPronunciation(row, supabaseUrl);
    if (pronunciation.available && typeof row.asset_id === "string") {
      pronunciationByAsset.set(row.asset_id, pronunciation);
      priorityByAsset.set(
        row.asset_id,
        syntheticAudioProfilePriority(row.profile_id),
      );
    }
  }
  const preferredBindings = sortSyntheticAudioBindingsByProfilePriority(
    acceptedBindings,
    priorityByAsset,
  );
  for (const binding of preferredBindings) {
    const pronunciation = pronunciationByAsset.get(binding.asset_id);
    if (pronunciation) {
      result.set(
        syntheticPronunciationBindingKey(
          binding.release_id,
          binding.vocab_entry_id,
        ),
        pronunciation,
      );
    }
  }
  return result;
}

async function loadApprovedKoreanPronunciationRegistry(
  dictionaryIds: readonly string[],
) {
  const approvedResult = new Map<string, QuizPronunciation>();
  if (dictionaryIds.length === 0) return approvedResult;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(dictionaryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_approved_korean_pronunciations")
      .select(
        "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, review_status",
      )
      .in("dictionary_id", chunk)
      .eq("review_status", "approved");
    if (error) {
      console.warn("[quiz-pronunciation] approved display lookup failed", {
        code: error.code,
      });
      return new Map<string, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabApprovedKoreanPronunciationRow[]) {
      const pronunciation = parseApprovedKoreanPronunciation(row);
      if (
        pronunciation?.variantId &&
        typeof row.dictionary_id === "string"
      ) {
        approvedResult.set(
          approvedKoreanPronunciationKey(
            row.dictionary_id,
            pronunciation.variantId,
          ),
          pronunciation,
        );
      }
    }
  }
  const ruleDerivedResult = new Map<string, QuizPronunciation>();
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_rule_derived_korean_pronunciations")
      .select(
        "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, derivation_status, engine_version, confidence, confidence_scope, stress_evidence, display_enabled",
      )
      .in("dictionary_id", chunk)
      .eq("display_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] rule-derived display lookup failed", {
        code: error.code,
      });
      return approvedResult;
    }
    for (const row of (data ?? []) as VocabRuleDerivedKoreanPronunciationRow[]) {
      const pronunciation = parseRuleDerivedKoreanPronunciation(row);
      if (pronunciation?.variantId && typeof row.dictionary_id === "string") {
        const key = approvedKoreanPronunciationKey(
          row.dictionary_id,
          pronunciation.variantId,
        );
        ruleDerivedResult.set(key, pronunciation);
      }
    }
  }
  return mergeKoreanPronunciationRegistries(
    approvedResult,
    ruleDerivedResult,
  );
}

type ExamUseQuestionSnapshot = {
  release_id?: string;
  occurrence_id?: string;
  dictionary_id?: string;
  pronunciation_variant_id?: string | null;
  headword_snapshot: string;
  primary_meaning_snapshot: string;
  display_pronunciation_ko_snapshot: string | null;
  pronunciation_snapshot: unknown;
  choice_dictionary_snapshots: unknown;
  provenance_status: "reviewed_for_preview_v1";
};

type ResultQuestionRow = {
  id: string;
  vocab_entry_id: number | null;
  order_index: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: unknown;
  correct_choice_index: number;
  initial_choice_index: number | null;
  initial_is_correct: boolean | null;
  retry_choice_index: number | null;
  retry_is_correct: boolean | null;
  prior_wrong_count: number;
  initial_timed_out?: boolean;
  retry_timed_out?: boolean;
  assignment_question:
    | AssignmentQuestionSnapshot
    | AssignmentQuestionSnapshot[]
    | null;
  vocab_entries:
    | {
        headword: string;
        primary_meaning: string;
        pronunciation_ko: string | null;
      }
    | Array<{
        headword: string;
        primary_meaning: string;
        pronunciation_ko: string | null;
      }>
    | null;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function reviewedExamUseSnapshot(
  question: AssignmentQuestionSnapshot | null,
): ExamUseQuestionSnapshot | null {
  const snapshot = oneRelation(question?.exam_use_snapshot ?? null);
  return snapshot?.provenance_status === "reviewed_for_preview_v1"
    ? snapshot
    : null;
}

export function mapResultQuestions(
  rows: ResultQuestionRow[],
  pronunciationRegistry: ReadonlyMap<number, QuizPronunciation> = new Map(),
  syntheticPronunciationRegistry: ReadonlyMap<string, QuizPronunciation> =
    new Map(),
  pronunciationDisplayRegistry: ReadonlyMap<number, string> = new Map(),
  approvedKoreanPronunciationRegistry: ReadonlyMap<
    string,
    QuizPronunciation
  > = new Map(),
  activeVocaPronunciationRegistry: ReadonlyMap<number, QuizPronunciation> =
    new Map(),
): AttemptQuestionResult[] {
  return rows.map((row) => {
    const choices = Array.isArray(row.choices)
      ? row.choices.filter(
          (choice): choice is string => typeof choice === "string",
        )
      : [];
    const vocabulary = Array.isArray(row.vocab_entries)
      ? row.vocab_entries[0]
      : row.vocab_entries;
    const bankQuestion = oneRelation(row.assignment_question);
    const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    const displayFallback =
      (vocabEntryId === null
        ? null
        : pronunciationDisplayRegistry.get(vocabEntryId)) ??
      vocabulary?.pronunciation_ko ??
      null;
    const snapshotPronunciation = withPronunciationDisplay(
      examUseSnapshot
        ? parseTargetPronunciation(
            examUseSnapshot.pronunciation_snapshot,
            examUseSnapshot.display_pronunciation_ko_snapshot,
          )
        : unavailablePronunciation(),
      displayFallback,
    );
    const pronunciation = preferredPronunciationWithActiveVocaRelease(
      examUseSnapshot?.dictionary_id,
      snapshotPronunciation,
      vocabEntryId === null
        ? undefined
        : activeVocaPronunciationRegistry.get(vocabEntryId),
      vocabEntryId === null
        ? undefined
        : pronunciationRegistry.get(vocabEntryId),
      typeof examUseSnapshot?.release_id === "string" &&
        typeof vocabEntryId === "number"
        ? syntheticPronunciationRegistry.get(
            syntheticPronunciationBindingKey(
              examUseSnapshot.release_id,
              vocabEntryId,
            ),
          )
        : undefined,
      approvedKoreanPronunciationRegistry,
    );
    const verifiedSnapshot = isTrustedQuestionSnapshot(
      bankQuestion?.provenance_status,
    )
      ? bankQuestion
      : null;

    return {
      id: row.id,
      orderIndex: row.order_index,
      direction: row.direction,
      prompt: row.prompt,
      correctAnswer: choices[row.correct_choice_index] ?? "",
      correctChoiceIndex: row.correct_choice_index,
      initialChoice:
        Boolean(row.initial_timed_out) ||
        row.initial_choice_index === null
          ? null
          : (choices[row.initial_choice_index] ?? null),
      initialIsCorrect: row.initial_is_correct,
      retryChoice:
        Boolean(row.retry_timed_out) ||
        row.retry_choice_index === null
          ? null
          : (choices[row.retry_choice_index] ?? null),
      retryIsCorrect: row.retry_is_correct,
      wrongCount:
        Math.max(0, row.prior_wrong_count) +
        (row.initial_is_correct === false ? 1 : 0),
      headword:
        examUseSnapshot?.headword_snapshot ??
        verifiedSnapshot?.headword_snapshot ??
        vocabulary?.headword ??
        "",
      primaryMeaning:
        examUseSnapshot?.primary_meaning_snapshot ??
        verifiedSnapshot?.primary_meaning_snapshot ??
        vocabulary?.primary_meaning ??
        "",
      pronunciation,
      provenanceStatus:
        examUseSnapshot?.provenance_status ??
        verifiedSnapshot?.provenance_status ?? "legacy_backfill",
    };
  });
}

export async function getAttemptQuestionResults(
  attemptId: string,
): Promise<AttemptQuestionResult[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_questions")
    .select(
      "id, vocab_entry_id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(vocab_entry_id, headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(release_id, occurrence_id, dictionary_id, pronunciation_variant_id, headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status)), vocab_entries(headword, primary_meaning, pronunciation_ko)",
    )
    .eq("attempt_id", attemptId)
    .order("order_index");

  if (error) {
    throw new Error("문항 결과를 불러오지 못했습니다.");
  }

  const rows = (data ?? []) as ResultQuestionRow[];
  const registryIds = rows.flatMap((row) => {
    const bankQuestion = oneRelation(row.assignment_question);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    return typeof vocabEntryId === "number"
      ? [vocabEntryId]
      : [];
  });
  const syntheticBindings = rows.flatMap((row) => {
    const bankQuestion = oneRelation(row.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    const vocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : row.vocab_entry_id;
    return typeof snapshot?.release_id === "string" &&
      typeof vocabEntryId === "number"
      ? [{ releaseId: snapshot.release_id, vocabEntryId }]
      : [];
  });
  const approvedDictionaryIds = rows.flatMap((row) => {
    const snapshot = reviewedExamUseSnapshot(oneRelation(row.assignment_question));
    return typeof snapshot?.dictionary_id === "string" ? [snapshot.dictionary_id] : [];
  });
  const [
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  ] = await Promise.all([
    loadVocabPronunciationRegistry(registryIds),
    loadSyntheticPronunciationRegistry(syntheticBindings),
    loadApprovedKoreanPronunciationRegistry(approvedDictionaryIds),
    loadActiveVocabPronunciationReleaseRegistry(registryIds),
  ]);

  return mapResultQuestions(
    rows,
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    new Map(),
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  );
}

export async function listStudentAssignments(
  studentId: string,
): Promise<StudentAssignmentSummary[]> {
  const [, missedFinalization] = await Promise.all([
    finalizeStaleQuizAttempts(),
    finalizeStudentMissedAssignments(studentId),
  ]);
  if (missedFinalization.batchLimitReached) {
    console.warn("[missed-assignment] student batch limit reached");
  }
  const supabase = getServiceSupabaseClient();
  const { data: linkData, error: linkError } = await supabase
    .from("assignment_students")
    .select("assignment_id, assigned_at, missed_at, cancelled_at")
    .eq("student_id", studentId)
    .is("cancelled_at", null);

  if (linkError) {
    throw new Error("배정된 시험 목록을 불러오지 못했습니다.");
  }
  if (!linkData?.length) {
    return [];
  }

  const assignmentIds = linkData.map((link) => link.assignment_id);
  const missedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.missed_at]),
  );
  const assignedAtByAssignment = new Map(
    linkData.map((link) => [link.assignment_id, link.assigned_at]),
  );
  const [
    { data: assignmentData, error: assignmentError },
    { data: attemptData, error: attemptError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, title, assignment_purpose, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, timing_mode, question_time_limit_seconds, passing_score, retake_allowed, range_basis, question_bank_version, question_order_mode, status, available_from, available_until",
      )
      .in("id", assignmentIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("quiz_attempts")
      .select(
        "id, assignment_id, status, phase, attempt_number, started_at, initial_completed_at, retry_started_at, deadline_at, completed_at, unresolved_wrong_count, initial_score, final_score, passed",
      )
      .eq("student_id", studentId)
      .in("assignment_id", assignmentIds)
      .order("attempt_number", { ascending: false }),
  ]);

  if (assignmentError || attemptError) {
    throw new Error("배정된 시험 상태를 불러오지 못했습니다.");
  }
  if (!assignmentData?.length) return [];

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const attempts = (attemptData ?? []) as AttemptRow[];
  const datasetIds = [...new Set(assignments.map((item) => item.dataset_id))];
  const [
    { data: datasetData, error: datasetError },
    { data: assignmentUnitData, error: assignmentUnitError },
  ] = await Promise.all([
    supabase
      .from("vocab_datasets")
      .select("id, title, edition")
      .in("id", datasetIds),
    supabase
      .from("assignment_units")
      .select(
        "assignment_id, position, is_primary, vocab_units(unit_label)",
      )
      .in("assignment_id", assignmentIds)
      .order("position"),
  ]);
  if (datasetError || assignmentUnitError) {
    throw new Error("시험 범위 정보를 불러오지 못했습니다.");
  }
  const datasetTitles = await loadDatasetDisplayLabelMap(
    supabase,
    (datasetData ?? []).map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      edition: dataset.edition,
    })),
  );
  const unitLabelsByAssignment = new Map<string, string[]>();
  const primaryUnitLabelsByAssignment = new Map<string, string[]>();
  for (const link of assignmentUnitData ?? []) {
    const relatedUnit = Array.isArray(link.vocab_units)
      ? link.vocab_units[0]
      : link.vocab_units;
    const labels = unitLabelsByAssignment.get(link.assignment_id) ?? [];
    if (relatedUnit?.unit_label) labels.push(relatedUnit.unit_label);
    unitLabelsByAssignment.set(link.assignment_id, labels);
    if (link.is_primary && relatedUnit?.unit_label) {
      const primaryLabels =
        primaryUnitLabelsByAssignment.get(link.assignment_id) ?? [];
      primaryLabels.push(relatedUnit.unit_label);
      primaryUnitLabelsByAssignment.set(
        link.assignment_id,
        primaryLabels,
      );
    }
  }
  const latestAttempts = new Map<string, AttemptRow>();
  for (const attempt of attempts) {
    if (!latestAttempts.has(attempt.assignment_id)) {
      latestAttempts.set(attempt.assignment_id, attempt);
    }
  }

  const now = Date.now();
  const summaries = assignments.map((assignment) => {
    const unitLabels =
      unitLabelsByAssignment.get(assignment.id) ?? [];
    const primaryUnitLabels =
      primaryUnitLabelsByAssignment.get(assignment.id) ?? [];
    const fallbackUnitLabels =
      unitLabels.length > 0
        ? unitLabels
        : [`${assignment.range_start}~${assignment.range_end}번`];
    const lastAttempt = latestAttempts.get(assignment.id);
    const availableUntilTime = assignment.available_until
      ? Date.parse(assignment.available_until)
      : Number.NaN;
    const missedAt =
      missedAtByAssignment.get(assignment.id) ?? null;
    const missed =
      !lastAttempt &&
      (missedAt !== null ||
        (!Number.isNaN(availableUntilTime) &&
          availableUntilTime <= now));
    const available =
      assignment.status === "active" &&
      (!assignment.available_from ||
        new Date(assignment.available_from).getTime() <= now) &&
      (!assignment.available_until ||
        new Date(assignment.available_until).getTime() > now);
    const canStart =
      !missed &&
      available &&
      (!lastAttempt ||
        lastAttempt.status === "expired" ||
        assignment.retake_allowed);
    const assignedAt =
      assignment.available_from ??
      assignedAtByAssignment.get(assignment.id) ??
      new Date(0).toISOString();
    const datasetTitle = datasetTitles.get(assignment.dataset_id) ?? "어휘";
    const summary: StudentAssignmentSummary = {
      id: assignment.id,
      title: assignment.title,
      displayTitle: assignmentDisplayTitleForUnits(
        assignment.title,
        [...fallbackUnitLabels, ...primaryUnitLabels],
        datasetTitle,
      ),
      datasetTitle,
      assignmentPurpose: assignment.assignment_purpose,
      scopeLabel: assignmentScopeLabel({
        assignmentPurpose: assignment.assignment_purpose,
        unitLabels: fallbackUnitLabels,
        primaryUnitLabels,
        questionCount: assignment.question_count,
      }),
      questionCount: assignment.question_count,
      questionOrderMode: assignment.question_order_mode,
      timeLimitSeconds: assignment.time_limit_seconds,
      timingMode: assignment.timing_mode,
      questionTimeLimitSeconds:
        assignment.question_time_limit_seconds,
      passingScore: assignment.passing_score,
      retakeAllowed: assignment.retake_allowed,
      lastAttemptId: lastAttempt?.id ?? null,
      lastStatus: lastAttempt?.status ?? null,
      lastPhase: lastAttempt?.phase ?? null,
      lastInitialScore:
        lastAttempt?.initial_score === null ||
        lastAttempt?.initial_score === undefined
          ? null
          : Number(lastAttempt.initial_score),
      lastFinalScore:
        lastAttempt?.final_score === null ||
        lastAttempt?.final_score === undefined
          ? null
          : Number(lastAttempt.final_score),
      lastPassed: lastAttempt?.passed ?? null,
      lastRetryStartedAt: lastAttempt?.retry_started_at ?? null,
      lastStartedAt: lastAttempt?.started_at ?? null,
      lastInitialCompletedAt:
        lastAttempt?.initial_completed_at ?? null,
      lastCompletedAt: lastAttempt?.completed_at ?? null,
      lastDeadlineAt: lastAttempt?.deadline_at ?? null,
      lastUnresolvedWrongCount:
        lastAttempt?.unresolved_wrong_count ?? null,
      assignedAt,
      availableUntil: assignment.available_until,
      missedAt,
      missed,
      canStart,
    };

    return summary;
  });

  return summaries;
}

export async function startStudentAttempt(
  studentId: string,
  assignmentId: string,
): Promise<string> {
  await finalizeStaleQuizAttempts();
  const supabase = getServiceSupabaseClient();
  const [{ data: assignmentData, error: assignmentError }, { data: linkData }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id, title, assignment_purpose, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, timing_mode, question_time_limit_seconds, passing_score, retake_allowed, range_basis, question_bank_version, question_order_mode, status, available_from, available_until",
        )
        .eq("id", assignmentId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("assignment_students")
        .select("assignment_id, missed_at, cancelled_at")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);
  const assignment = assignmentData as AssignmentRow | null;

  if (
    assignmentError ||
    !assignment ||
    !linkData ||
    linkData.missed_at !== null ||
    linkData.cancelled_at !== null
  ) {
    throw new Error("배정된 시험을 찾지 못했습니다.");
  }

  const { data: existingAttempt, error: existingAttemptError } =
    await supabase
      .from("quiz_attempts")
      .select("id")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
  if (existingAttemptError) {
    throw new Error("진행 중인 시험을 확인하지 못했습니다.");
  }
  if (existingAttempt) return existingAttempt.id;

  if (
    assignment.range_basis === "units" &&
    assignment.question_bank_version !== null
  ) {
    const { data, error } = await supabase.rpc(
      "create_quiz_attempt_from_bank",
      {
        p_student_id: studentId,
        p_assignment_id: assignmentId,
      },
    );

    if (error || typeof data !== "string") {
      const { data: recoveredAttempt } = await supabase
        .from("quiz_attempts")
        .select("id")
        .eq("student_id", studentId)
        .eq("assignment_id", assignmentId)
        .eq("status", "in_progress")
        .maybeSingle();
      if (recoveredAttempt) return recoveredAttempt.id;
      throw new Error("시험을 시작하지 못했습니다.");
    }

    return data;
  }

  const entryData: Array<{
    id: number;
    source_row: number;
    headword: string;
    headword_normalized: string;
    primary_meaning: string;
  }> = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data: page, error: entryError } = await supabase
      .from("vocab_entries")
      .select(
        "id, source_row, headword, headword_normalized, primary_meaning",
      )
      .eq("dataset_id", assignment.dataset_id)
      .gte("source_row", assignment.range_start)
      .lte("source_row", assignment.range_end)
      .order("source_row")
      .range(offset, offset + pageSize - 1);

    if (entryError) {
      throw new Error("시험 어휘를 불러오지 못했습니다.");
    }

    entryData.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  const uniqueEntries = new Map<string, QuizVocabularyEntry>();
  for (const entry of entryData) {
    const key = entry.headword_normalized.normalize("NFC").toLocaleLowerCase(
      "en-US",
    );
    if (!uniqueEntries.has(key)) {
      uniqueEntries.set(key, {
        id: entry.id,
        headword: entry.headword,
        primaryMeaning: entry.primary_meaning,
      });
    }
  }

  const questions = createQuizQuestions(
    [...uniqueEntries.values()],
    assignment.question_count,
    assignment.english_to_korean_ratio,
  );
  const { data, error } = await supabase.rpc("create_quiz_attempt", {
    p_student_id: studentId,
    p_assignment_id: assignmentId,
    p_questions: questions.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      order_index: index + 1,
      direction: question.direction,
      prompt: question.prompt,
      choices: question.choices,
      correct_choice_index: question.correctChoiceIndex,
    })),
  });

  if (error || typeof data !== "string") {
    const { data: recoveredAttempt } = await supabase
      .from("quiz_attempts")
      .select("id")
      .eq("student_id", studentId)
      .eq("assignment_id", assignmentId)
      .eq("status", "in_progress")
      .maybeSingle();
    if (recoveredAttempt) return recoveredAttempt.id;
    throw new Error("시험을 시작하지 못했습니다.");
  }

  return data;
}

export async function getStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<AttemptState | null> {
  const supabase = getServiceSupabaseClient();
  const { data: attemptData, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, started_at, deadline_at, current_question_started_at",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (attemptError) throw attemptError;
  if (!attemptData) return null;

  if (
    attemptData.status === "in_progress" &&
    attemptData.phase !== "review" &&
    new Date(attemptData.deadline_at).getTime() <= Date.now()
  ) {
    await expireStudentAttempt(studentId, attemptId);
    attemptData.status = "expired";
    attemptData.phase = "completed";
  }

  const [assignmentResult, questionResult] =
    await Promise.all([
      supabase
        .from("assignments")
        .select("title, timing_mode, question_time_limit_seconds")
        .eq("id", attemptData.assignment_id)
        .maybeSingle(),
      supabase
        .from("quiz_questions")
        .select(
          "id, vocab_entry_id, order_index, direction, prompt, choices, correct_choice_index, initial_choice_index, initial_is_correct, retry_choice_index, retry_is_correct, prior_wrong_count, initial_timed_out, retry_timed_out, assignment_question:assignment_questions!quiz_questions_assignment_question_id_fkey(vocab_entry_id, choice_vocab_entry_ids, headword_snapshot, primary_meaning_snapshot, provenance_status, exam_use_snapshot:assignment_question_exam_use_snapshot!assignment_question_exam_use_snapshot_question_fkey(release_id, occurrence_id, dictionary_id, pronunciation_variant_id, headword_snapshot, primary_meaning_snapshot, display_pronunciation_ko_snapshot, pronunciation_snapshot, choice_dictionary_snapshots, provenance_status))",
        )
        .eq("attempt_id", attemptId)
        .order("order_index"),
    ]);

  if (assignmentResult.error) throw assignmentResult.error;
  if (questionResult.error) throw questionResult.error;
  if (!assignmentResult.data) {
    throw new Error("quiz_assignment_missing");
  }

  const assignmentData = assignmentResult.data;
  const questionData = questionResult.data;

  const rows = (questionData ?? []) as QuestionRow[];
  const registryIds = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const targetVocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : question.vocab_entry_id;
    return [
      targetVocabEntryId,
      ...(bankQuestion?.choice_vocab_entry_ids ?? []),
    ].filter((value): value is number => typeof value === "number");
  });
  const approvedDictionaryIds = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    if (!snapshot) return [];
    const choiceIds = parseChoiceDictionaryIds(
      snapshot.choice_dictionary_snapshots,
      question.choices,
    ).filter((value): value is string => typeof value === "string");
    return [
      ...(typeof snapshot.dictionary_id === "string"
        ? [snapshot.dictionary_id]
        : []),
      ...choiceIds,
    ];
  });
  const syntheticBindings = rows.flatMap((question) => {
    const bankQuestion = oneRelation(question.assignment_question);
    const snapshot = reviewedExamUseSnapshot(bankQuestion);
    if (typeof snapshot?.release_id !== "string") return [];
    const targetVocabEntryId =
      typeof bankQuestion?.vocab_entry_id === "number"
        ? bankQuestion.vocab_entry_id
        : question.vocab_entry_id;
    return [
      targetVocabEntryId,
      ...(bankQuestion?.choice_vocab_entry_ids ?? []),
    ]
      .filter((value): value is number => typeof value === "number")
      .map((vocabEntryId) => ({
        releaseId: snapshot.release_id as string,
        vocabEntryId,
      }));
  });
  const [
    pronunciationRegistry,
    syntheticPronunciationRegistry,
    pronunciationDisplayRegistry,
    approvedKoreanPronunciationRegistry,
    activeVocaPronunciationRegistry,
  ] = await Promise.all([
    loadVocabPronunciationRegistry(registryIds),
    loadSyntheticPronunciationRegistry(syntheticBindings),
    loadVocabPronunciationDisplayRegistry(registryIds),
    loadApprovedKoreanPronunciationRegistry(approvedDictionaryIds),
    loadActiveVocabPronunciationReleaseRegistry(registryIds),
  ]);
  const initialCurrent = rows.find(
    (question) => question.initial_choice_index === null,
  );
  const retryCurrent = rows.find(
    (question) =>
      question.initial_is_correct === false &&
      question.retry_choice_index === null,
  );
  const phase: AttemptState["phase"] =
    attemptData.status !== "in_progress"
      ? "completed"
      : attemptData.phase;
  const currentQuestionId =
    phase === "initial"
      ? (initialCurrent?.id ?? null)
      : phase === "retry"
        ? (retryCurrent?.id ?? null)
        : null;
  if (
    attemptData.status === "in_progress" &&
    (phase === "initial" || phase === "retry") &&
    (!questionData || questionData.length === 0 || !currentQuestionId)
  ) {
    throw new Error("quiz_attempt_question_state_invalid");
  }
  const timingMode =
    (assignmentData?.timing_mode as TimingMode | undefined) ?? "total";
  const questionTimeLimitSeconds =
    assignmentData?.question_time_limit_seconds ?? null;
  const timerDeadlineAt =
    timingMode === "per_question" && questionTimeLimitSeconds
      ? new Date(
          Date.parse(attemptData.current_question_started_at) +
            questionTimeLimitSeconds * 1000,
        ).toISOString()
      : attemptData.deadline_at;

  return {
    id: attemptData.id,
    assignmentTitle: assignmentData?.title ?? "단어 시험",
    status: attemptData.status,
    phase,
    startedAt: attemptData.started_at,
    deadlineAt: attemptData.deadline_at,
    timerDeadlineAt,
    timingMode,
    questionTimeLimitSeconds,
    currentQuestionId,
    questions: rows.map((question) => {
      const answered =
        question.initial_choice_index !== null ||
        question.retry_choice_index !== null;
      const bankQuestion = oneRelation(question.assignment_question);
      const targetVocabEntryId =
        typeof bankQuestion?.vocab_entry_id === "number"
          ? bankQuestion.vocab_entry_id
          : question.vocab_entry_id;
      const examUseSnapshot = reviewedExamUseSnapshot(bankQuestion);
      const targetDisplayFallback =
        typeof targetVocabEntryId === "number"
          ? pronunciationDisplayRegistry.get(targetVocabEntryId)
          : null;
      const snapshotPronunciation = withPronunciationDisplay(
        examUseSnapshot
          ? parseTargetPronunciation(
              examUseSnapshot.pronunciation_snapshot,
              examUseSnapshot.display_pronunciation_ko_snapshot,
            )
          : unavailablePronunciation(),
        targetDisplayFallback,
      );
      const snapshotChoicePronunciations = examUseSnapshot
        ? parseChoicePronunciations(
            examUseSnapshot.choice_dictionary_snapshots,
            question.choices,
          )
        : question.choices.map(() => unavailablePronunciation());
      const snapshotChoiceDictionaryIds = examUseSnapshot
        ? parseChoiceDictionaryIds(
            examUseSnapshot.choice_dictionary_snapshots,
            question.choices,
          )
        : question.choices.map(() => null);
      const pronunciation = preferredPronunciationWithActiveVocaRelease(
        examUseSnapshot?.dictionary_id,
        snapshotPronunciation,
        typeof targetVocabEntryId === "number"
          ? activeVocaPronunciationRegistry.get(targetVocabEntryId)
          : undefined,
        typeof targetVocabEntryId === "number"
          ? pronunciationRegistry.get(targetVocabEntryId)
          : undefined,
        typeof examUseSnapshot?.release_id === "string" &&
          typeof targetVocabEntryId === "number"
          ? syntheticPronunciationRegistry.get(
              syntheticPronunciationBindingKey(
                examUseSnapshot.release_id,
                targetVocabEntryId,
              ),
            )
          : undefined,
        approvedKoreanPronunciationRegistry,
      );
      const choiceVocabEntryIds = completeChoiceVocabEntryIds(
        bankQuestion?.choice_vocab_entry_ids,
        question.choices.length,
      );
      const choicePronunciations = question.choices.map((_, index) => {
        const choiceVocabEntryId = choiceVocabEntryIds[index];
        const choiceDictionaryId = snapshotChoiceDictionaryIds[index];
        const choiceSnapshotPronunciation =
          snapshotChoicePronunciations[index] ?? unavailablePronunciation();
        return preferredPronunciationWithActiveVocaRelease(
          choiceDictionaryId,
          withPronunciationDisplay(
            choiceSnapshotPronunciation,
            typeof choiceVocabEntryId === "number"
              ? pronunciationDisplayRegistry.get(choiceVocabEntryId)
              : null,
          ),
          typeof choiceVocabEntryId === "number"
            ? activeVocaPronunciationRegistry.get(choiceVocabEntryId)
            : undefined,
          typeof choiceVocabEntryId === "number"
            ? pronunciationRegistry.get(choiceVocabEntryId)
            : undefined,
          typeof examUseSnapshot?.release_id === "string" &&
            typeof choiceVocabEntryId === "number"
            ? syntheticPronunciationRegistry.get(
                syntheticPronunciationBindingKey(
                  examUseSnapshot.release_id,
                  choiceVocabEntryId,
                ),
              )
            : undefined,
          approvedKoreanPronunciationRegistry,
        );
      });

      return {
        id: question.id,
        orderIndex: question.order_index,
        direction: question.direction,
        prompt: question.prompt,
        choices: question.choices,
        pronunciation,
        choicePronunciations,
        initialChoiceIndex: question.initial_choice_index,
        initialIsCorrect: question.initial_is_correct,
        retryChoiceIndex: question.retry_choice_index,
        retryIsCorrect: question.retry_is_correct,
        priorWrongLevel:
          question.prior_wrong_count >= 2
            ? 2
            : question.prior_wrong_count === 1
              ? 1
              : 0,
        initialTimedOut: Boolean(question.initial_timed_out),
        retryTimedOut: Boolean(question.retry_timed_out),
        revealedCorrectChoiceIndex: answered
          ? question.correct_choice_index
          : null,
      };
    }),
  };
}

export async function expireStudentAttempt(
  studentId: string,
  attemptId: string,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  const { error } = await supabase.rpc("expire_quiz_attempt", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
  });

  if (error) {
    throw new Error("시험 종료상태를 저장하지 못했습니다.");
  }
}

export async function startStudentRetry(
  studentId: string,
  attemptId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc("start_quiz_retry", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
  });

  if (error || !data) {
    throw new Error("재시험을 시작하지 못했습니다.");
  }

  return data as {
    phase: "retry";
    nextQuestionId: string;
    deadlineAt: string;
  };
}

export async function answerStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
  choiceIndex: number;
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc("answer_quiz_question_v2", {
    p_student_id: input.studentId,
    p_attempt_id: input.attemptId,
    p_question_id: input.questionId,
    p_phase: input.phase,
    p_choice_index: input.choiceIndex,
    p_force_timeout: false,
  });

  if (error || !data) {
    throw new Error("답안을 저장하지 못했습니다.");
  }

  return data as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    initialAnsweredCount?: number;
    initialQuestionCount?: number;
    retryAnsweredCount?: number;
    retryQuestionCount?: number;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
  };
}

export async function timeoutStudentQuestion(input: {
  studentId: string;
  attemptId: string;
  questionId: string;
  phase: "initial" | "retry";
}) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "answer_quiz_question_v2",
    {
      p_student_id: input.studentId,
      p_attempt_id: input.attemptId,
      p_question_id: input.questionId,
      p_phase: input.phase,
      p_choice_index: 0,
      p_force_timeout: true,
    },
  );
  if (error || !data) {
    throw new Error("시간 초과 상태를 저장하지 못했습니다.");
  }
  return data as {
    correct?: boolean;
    correctChoiceIndex?: number;
    completed?: boolean;
    needsRetry?: boolean;
    expired?: boolean;
    nextQuestionId?: string | null;
    nextPhase?: "initial" | "retry" | null;
    timedOut?: boolean;
    questionDeadlineAt?: string | null;
  };
}

export async function getAttemptResult(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptResult | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select(
      "id, assignment_id, status, phase, attempt_number, question_count_snapshot, initial_correct_count, retry_correct_count, unresolved_wrong_count, initial_score, final_score, passed, elapsed_seconds, started_at, initial_completed_at, completed_at, assignments(title)",
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  const questions = await getAttemptQuestionResults(attemptId);

  const assignment = Array.isArray(data.assignments)
    ? data.assignments[0]
    : data.assignments;
  const reviewing =
    data.status === "in_progress" && data.phase === "review";
  const reviewMetrics = reviewing
    ? deriveAttemptQuestionMetrics(questions)
    : null;
  const reviewElapsedSeconds =
    reviewing && data.initial_completed_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(data.initial_completed_at).getTime() -
              new Date(data.started_at).getTime()) /
              1000,
          ),
        )
      : null;

  return {
    id: data.id,
    title: assignment?.title ?? "단어 시험",
    status: data.status as StudentAttemptResult["status"],
    phase: data.phase as AttemptState["phase"],
    attemptNumber: data.attempt_number,
    questionCount: data.question_count_snapshot,
    initialCorrectCount:
      reviewMetrics?.initialCorrectCount ?? data.initial_correct_count,
    retryCorrectCount:
      reviewMetrics?.retryCorrectCount ?? data.retry_correct_count,
    unresolvedWrongCount:
      reviewMetrics?.unresolvedWrongCount ??
      data.unresolved_wrong_count,
    initialScore:
      reviewMetrics?.initialScore ??
      (data.initial_score === null ? null : Number(data.initial_score)),
    finalScore: data.final_score === null ? null : Number(data.final_score),
    passed: data.passed,
    elapsedSeconds: reviewElapsedSeconds ?? data.elapsed_seconds,
    startedAt: data.started_at,
    initialCompletedAt: data.initial_completed_at,
    completedAt: data.completed_at,
    questions,
  };
}
