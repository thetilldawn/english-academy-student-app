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
        const { data, error } = await supabase.rpc(
          "list_active_exam_use_eligibility_v1",
          { p_dataset_id: datasetId },
        );
        if (error) {
          throw new Error(
            "검토된 단어사전 출제 정보를 불러오지 못했습니다.",
          );
        }
        if (data && data.length > 0) {
          return data as VocabularyEligibilitySourceRow[];
        }
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
            "vocab_entry_id, quiz_mode, canonical_lexeme_id",
          )
          .eq("dataset_id", datasetId)
          .eq("status", "eligible")
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
