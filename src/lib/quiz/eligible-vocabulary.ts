import type {
  QuizDirection,
  QuizVocabularyEntry,
} from "@/lib/quiz/engine";

export type VocabularyEntrySourceRow = {
  id: number;
  unit_id: string;
  source_row: number;
  headword: string;
  headword_normalized: string;
  primary_meaning: string;
};

export type VocabularyEligibilitySourceRow = {
  vocab_entry_id: number;
  quiz_mode:
    | "book_meaning_en_to_ko"
    | "book_meaning_ko_to_en";
  canonical_lexeme_id: string | null;
  canonical_dictionary_id?: string | null;
};

export type EligibleVocabularyEntry = QuizVocabularyEntry & {
  unitId: string;
  sourceRow: number;
  headwordNormalized: string;
  canonicalDictionaryId: string | null;
  canonicalLexemeId: string | null;
};

export function mergeEligibleVocabularyRows(
  entries: readonly VocabularyEntrySourceRow[],
  eligibilityRows: readonly VocabularyEligibilitySourceRow[],
): EligibleVocabularyEntry[] {
  const entryIds = new Set<number>();
  for (const entry of entries) {
    if (entryIds.has(entry.id)) {
      throw new Error("단어장 어휘 ID가 중복되었습니다.");
    }
    entryIds.add(entry.id);
  }

  const eligibilityByEntry = new Map<
    number,
    {
      canonicalKeys: Set<string>;
      dictionaryKeys: Set<string>;
      directions: Set<QuizDirection>;
      modes: Set<VocabularyEligibilitySourceRow["quiz_mode"]>;
    }
  >();
  for (const row of eligibilityRows) {
    const current = eligibilityByEntry.get(row.vocab_entry_id) ?? {
      canonicalKeys: new Set<string>(),
      dictionaryKeys: new Set<string>(),
      directions: new Set<QuizDirection>(),
      modes: new Set<VocabularyEligibilitySourceRow["quiz_mode"]>(),
    };
    if (current.modes.has(row.quiz_mode)) {
      throw new Error("한 단어의 출제 가능 모드가 중복되었습니다.");
    }
    current.modes.add(row.quiz_mode);
    current.directions.add(
      row.quiz_mode === "book_meaning_en_to_ko"
        ? "english_to_korean"
        : "korean_to_english",
    );
    if (row.canonical_lexeme_id) {
      current.canonicalKeys.add(row.canonical_lexeme_id);
    }
    if (row.canonical_dictionary_id) {
      current.dictionaryKeys.add(row.canonical_dictionary_id);
    }
    eligibilityByEntry.set(row.vocab_entry_id, current);
  }

  const candidates: EligibleVocabularyEntry[] = [];
  for (const entry of entries) {
    const eligibility = eligibilityByEntry.get(entry.id);
    if (!eligibility || eligibility.directions.size === 0) continue;
    if (eligibility.canonicalKeys.size > 1) {
      throw new Error(
        "한 단어의 출제 방향별 표준 표제어 연결이 서로 다릅니다.",
      );
    }
    if (eligibility.dictionaryKeys.size > 1) {
      throw new Error(
        "한 단어의 출제 방향별 단어사전 ID가 서로 다릅니다.",
      );
    }
    const canonicalDictionaryId = [...eligibility.dictionaryKeys][0] ?? null;
    const canonicalLexemeId = [...eligibility.canonicalKeys][0] ?? null;
    candidates.push({
      id: entry.id,
      unitId: entry.unit_id,
      sourceRow: entry.source_row,
      headword: entry.headword,
      headwordNormalized: entry.headword_normalized,
      primaryMeaning: entry.primary_meaning,
      canonicalDictionaryId,
      canonicalLexemeId,
      canonicalKey: canonicalDictionaryId ?? canonicalLexemeId,
      recordType: (() => {
        const dictionaryId = [...eligibility.dictionaryKeys][0];
        const prefix = dictionaryId?.split(":", 1)[0];
        return prefix === "word" ||
          prefix === "root_affix" ||
          prefix === "expression"
          ? prefix
          : null;
      })(),
      eligibleDirections: [...eligibility.directions],
    });
  }
  return candidates;
}
