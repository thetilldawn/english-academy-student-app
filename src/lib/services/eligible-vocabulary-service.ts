import "server-only";

import {
  mergeEligibleVocabularyRows,
  type VocabularyEligibilitySourceRow,
  type VocabularyEntrySourceRow,
} from "@/lib/quiz/eligible-vocabulary";
import type { createServerSupabaseClient } from "@/lib/supabase/server";

export const ELIGIBLE_VOCABULARY_PAGE_SIZE = 1000;

type EligibleVocabularyLoadOptions = {
  includeExamUseProjection?: boolean;
};

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

async function loadExamUseEligibility(
  supabase: ServerSupabaseClient,
  datasetId: string,
) {
  const rows: VocabularyEligibilitySourceRow[] = [];
  let previous: VocabularyEligibilitySourceRow | null = null;
  for (;;) {
    // One vocabulary entry has two direction rows. A single RPC response can
    // therefore truncate a 601-word book to 500 words at the API's row limit.
    const { data, error } = await supabase
      .rpc("list_active_exam_use_eligibility_v1", { p_dataset_id: datasetId })
      .order("vocab_entry_id")
      .order("quiz_mode")
      .range(rows.length, rows.length + ELIGIBLE_VOCABULARY_PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || data.length > ELIGIBLE_VOCABULARY_PAGE_SIZE) {
      throw new Error("검토된 단어사전 출제 정보를 불러오지 못했습니다.");
    }
    if (data.length === 0) return rows;
    for (const row of data as VocabularyEligibilitySourceRow[]) {
      if (
        !row || !Number.isSafeInteger(row.vocab_entry_id) || row.vocab_entry_id < 1 ||
        !["book_meaning_en_to_ko", "book_meaning_ko_to_en"].includes(row.quiz_mode) ||
        (previous && (
          row.vocab_entry_id < previous.vocab_entry_id ||
          (row.vocab_entry_id === previous.vocab_entry_id && row.quiz_mode <= previous.quiz_mode)
        ))
      ) {
        throw new Error("검토된 단어사전 출제 정보를 불러오지 못했습니다.");
      }
      rows.push(row);
      previous = row;
    }
    // Advance by received rows, not requested page size; a smaller response
    // limit must not skip records. Strict ordering also rejects repeated pages.
  }
}

export async function loadEligibleVocabularyDataset(
  supabase: ServerSupabaseClient,
  datasetId: string,
  options: EligibleVocabularyLoadOptions = {},
) {
  const [entries, eligibilityRows] = await Promise.all([
    (async () => {
      const rows: VocabularyEntrySourceRow[] = [];
      for (
        let offset = 0;
        ;
        offset += ELIGIBLE_VOCABULARY_PAGE_SIZE
      ) {
        const { data, error } = await supabase
          .from("vocab_entries")
          .select(
            "id, unit_id, source_row, headword, headword_normalized, primary_meaning",
          )
          .eq("dataset_id", datasetId)
          .order("source_row")
          .range(
            offset,
            offset + ELIGIBLE_VOCABULARY_PAGE_SIZE - 1,
          );
        if (error) {
          throw new Error("단어장의 어휘를 불러오지 못했습니다.");
        }
        rows.push(...((data ?? []) as VocabularyEntrySourceRow[]));
        if (
          !data ||
          data.length < ELIGIBLE_VOCABULARY_PAGE_SIZE
        ) {
          break;
        }
      }
      return rows;
    })(),
    (async () => {
      if (options.includeExamUseProjection) {
        const rows = await loadExamUseEligibility(supabase, datasetId);
        if (rows.length > 0) return rows;
      }

      const rows: VocabularyEligibilitySourceRow[] = [];
      for (
        let offset = 0;
        ;
        offset += ELIGIBLE_VOCABULARY_PAGE_SIZE
      ) {
        const { data, error } = await supabase
          .from("vocab_entry_quiz_eligibility")
          .select(
            "vocab_entry_id, quiz_mode, canonical_lexeme_id, status, reason_codes",
          )
          .eq("dataset_id", datasetId)
          .in("status", ["eligible", "review_required"])
          .order("vocab_entry_id")
          .order("quiz_mode")
          .range(
            offset,
            offset + ELIGIBLE_VOCABULARY_PAGE_SIZE - 1,
          );
        if (error) {
          throw new Error(
            "출제 가능한 어휘 정보를 불러오지 못했습니다.",
          );
        }
        rows.push(
          ...((data ?? []) as VocabularyEligibilitySourceRow[]),
        );
        if (
          !data ||
          data.length < ELIGIBLE_VOCABULARY_PAGE_SIZE
        ) {
          break;
        }
      }
      return rows;
    })(),
  ]);

  return mergeEligibleVocabularyRows(entries, eligibilityRows);
}
