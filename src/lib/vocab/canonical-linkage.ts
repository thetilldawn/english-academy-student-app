import { createHash } from "node:crypto";

import type { NormalizedVocabularyEntry } from "@/lib/vocab/import-contract";

const WORD_INDEX_NAMESPACE = "b3ba6814-4bed-5f65-9bf1-d2c0a3b6875e";

export type CanonicalLexemeForLinkage = {
  lexemeId: string;
  headword: string;
  normalizedHeadword: string;
  lexemeType: string;
  typeStatus: string;
  lifecycleStatus: string;
  contentHash: string;
  pronunciationKo: string | null;
  isReady: boolean;
  legacyReadyClaim: boolean;
};

export type NonWordCandidate = {
  lexemeId: string;
  headword: string;
  lexemeType: string;
};

export type EntryLexemeLink = {
  sourceRow: number;
  entryRowSha256: string;
  contentSha256: string;
  locatorSha256: string;
  headword: string;
  normalizedHeadword: string;
  unitLabel: string;
  unitNumber: number | null;
  positionInUnit: number;
  entryType: string;
  bookMeaningKo: string;
  mappingStatus:
    | "exact_headword_unreviewed"
    | "ambiguous"
    | "unresolved";
  mappingMethod: "normalized_headword_exact_v1";
  lexemeId: string | null;
  lexemeContentHash: string | null;
  canonicalTypeStatus: string | null;
  canonicalIsReady: boolean;
  legacyReadyClaim: boolean;
  nonWordCandidates: NonWordCandidate[];
};

export type EntryQuizEligibility = {
  sourceRow: number;
  entryRowSha256: string;
  englishToKoreanStatus: "eligible" | "review_required";
  koreanToEnglishStatus: "eligible" | "review_required";
  combinedStatus: "eligible" | "review_required";
  reasonCodes: string[];
};

function normalizeSpace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLegacyImportKey(value: string, locale: string) {
  return normalizeSpace(value.normalize("NFC")).toLocaleLowerCase(locale);
}

export function normalizeCanonicalHeadword(value: string) {
  return normalizeSpace(
    value.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll("*", ""),
  );
}

export function normalizeMeaningKey(value: string) {
  return normalizeSpace(value.normalize("NFKC")).toLocaleLowerCase("ko-KR");
}

export function sha256(parts: readonly unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify(parts), "utf8")
    .digest("hex")
    .toUpperCase();
}

function uuidToBytes(uuid: string) {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error(`잘못된 UUID입니다: ${uuid}`);
  }
  return Buffer.from(hex, "hex");
}

export function stableWordIndexId(kind: string, key: string) {
  const hash = createHash("sha1")
    .update(uuidToBytes(WORD_INDEX_NAMESPACE))
    .update(`${kind}|${key.normalize("NFC")}`, "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function buildEntryLexemeLinks(
  datasetKey: string,
  entries: readonly NormalizedVocabularyEntry[],
  canonicalLexemes: readonly CanonicalLexemeForLinkage[],
  nonWordCandidates: readonly NonWordCandidate[],
): EntryLexemeLink[] {
  const activeWords = new Map<string, CanonicalLexemeForLinkage[]>();
  for (const lexeme of canonicalLexemes) {
    if (
      lexeme.lexemeType !== "word" ||
      lexeme.lifecycleStatus !== "active"
    ) {
      continue;
    }
    const key = normalizeCanonicalHeadword(lexeme.normalizedHeadword);
    const values = activeWords.get(key) ?? [];
    values.push(lexeme);
    activeWords.set(key, values);
  }

  const otherTypes = new Map<string, NonWordCandidate[]>();
  for (const candidate of nonWordCandidates) {
    const key = normalizeCanonicalHeadword(candidate.headword);
    const values = otherTypes.get(key) ?? [];
    values.push(candidate);
    otherTypes.set(key, values);
  }

  return entries.map((entry) => {
    const normalizedHeadword = normalizeCanonicalHeadword(entry.headword);
    const matches = activeWords.get(normalizedHeadword) ?? [];
    const matched = matches.length === 1 ? matches[0] : null;
    const mappingStatus =
      matches.length === 1
        ? "exact_headword_unreviewed"
        : matches.length > 1
          ? "ambiguous"
          : "unresolved";

    return {
      sourceRow: entry.sourceRow,
      entryRowSha256: entry.rowSha256,
      contentSha256: sha256([
        datasetKey,
        normalizedHeadword,
        entry.entryType,
        normalizeMeaningKey(entry.primaryMeaning),
      ]),
      locatorSha256: sha256([
        datasetKey,
        entry.sourceRow,
        entry.unitNormalizedLabel,
        entry.positionInUnit,
      ]),
      headword: entry.headword,
      normalizedHeadword,
      unitLabel: entry.unitLabel,
      unitNumber: entry.unitNumber,
      positionInUnit: entry.positionInUnit,
      entryType: entry.entryType,
      bookMeaningKo: entry.primaryMeaning,
      mappingStatus,
      mappingMethod: "normalized_headword_exact_v1",
      lexemeId: matched?.lexemeId ?? null,
      lexemeContentHash: matched?.contentHash ?? null,
      canonicalTypeStatus: matched?.typeStatus ?? null,
      canonicalIsReady: matched?.isReady ?? false,
      legacyReadyClaim: matched?.legacyReadyClaim ?? false,
      nonWordCandidates:
        mappingStatus === "unresolved"
          ? (otherTypes.get(normalizedHeadword) ?? [])
          : [],
    };
  });
}

export function evaluateBookQuizEligibility(
  entries: readonly NormalizedVocabularyEntry[],
): EntryQuizEligibility[] {
  const meaningKeysByHeadword = new Map<string, Set<string>>();
  const headwordsByMeaning = new Map<string, Set<string>>();

  for (const entry of entries) {
    const headwordKey = normalizeCanonicalHeadword(entry.headword);
    const meaningKey = normalizeMeaningKey(entry.primaryMeaning);

    const meaningKeys = meaningKeysByHeadword.get(headwordKey) ?? new Set();
    meaningKeys.add(meaningKey);
    meaningKeysByHeadword.set(headwordKey, meaningKeys);

    const headwords = headwordsByMeaning.get(meaningKey) ?? new Set();
    headwords.add(headwordKey);
    headwordsByMeaning.set(meaningKey, headwords);
  }

  return entries.map((entry) => {
    const headwordKey = normalizeCanonicalHeadword(entry.headword);
    const meaningKey = normalizeMeaningKey(entry.primaryMeaning);
    const reasonCodes: string[] = [];

    if ((meaningKeysByHeadword.get(headwordKey)?.size ?? 0) > 1) {
      reasonCodes.push("DUPLICATE_HEADWORD_DIFFERENT_MEANING");
    }
    if ((headwordsByMeaning.get(meaningKey)?.size ?? 0) > 1) {
      reasonCodes.push("DUPLICATE_PRIMARY_MEANING_DIFFERENT_HEADWORD");
    }

    const englishToKoreanStatus = reasonCodes.includes(
      "DUPLICATE_HEADWORD_DIFFERENT_MEANING",
    )
      ? "review_required"
      : "eligible";
    const koreanToEnglishStatus =
      reasonCodes.length > 0 ? "review_required" : "eligible";

    return {
      sourceRow: entry.sourceRow,
      entryRowSha256: entry.rowSha256,
      englishToKoreanStatus,
      koreanToEnglishStatus,
      combinedStatus:
        englishToKoreanStatus === "eligible" &&
        koreanToEnglishStatus === "eligible"
          ? "eligible"
          : "review_required",
      reasonCodes,
    };
  });
}

export function summarizeHeadwordMeaningConflicts(
  entries: readonly NormalizedVocabularyEntry[],
  mode: "canonical" | "legacy_nfc",
) {
  const meaningsByHeadword = new Map<string, string[]>();
  for (const entry of entries) {
    const headword =
      mode === "canonical"
        ? normalizeCanonicalHeadword(entry.headword)
        : normalizeLegacyImportKey(entry.headword, "en-US");
    const meaning =
      mode === "canonical"
        ? normalizeMeaningKey(entry.primaryMeaning)
        : normalizeLegacyImportKey(entry.primaryMeaning, "ko-KR");
    const values = meaningsByHeadword.get(headword) ?? [];
    values.push(meaning);
    meaningsByHeadword.set(headword, values);
  }

  const conflicting = [...meaningsByHeadword.values()].filter(
    (values) => new Set(values).size > 1,
  );
  return {
    groups: conflicting.length,
    rows: conflicting.reduce((total, values) => total + values.length, 0),
  };
}
