import { z } from "zod";
import { isVocabPronunciationStorageKey } from "./pronunciation-storage";
import type { QuizPronunciation } from "./pronunciation-snapshot";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const rowSchema = z.object({
  vocab_entry_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  headword: z.string().trim().min(1).max(200),
  entry_row_sha256: hash,
  variant_id: z.string().min(1).max(200),
  audio_key: z.string().min(1).max(1024),
  display_ko: z.string().min(1).max(200),
  segments: z.array(z.object({ text: z.string().min(1), stress: z.enum(["none", "primary", "secondary"]) }).strict()).min(1).max(100),
  source_file_sha256: hash,
  manifest_sha256: hash,
}).strict();

// Server-only proof is removed before UI serialization. Multiple historical
// voices may coexist, but no headword/voice guessing or last-write-wins.
export type EntrySourcePronunciation = {
  entryId: number;
  headword: string;
  pronunciation: QuizPronunciation;
};
export type EntrySourceContext = {
  headword: string | null | undefined;
  restorations: readonly EntrySourcePronunciation[] | undefined;
};

export function parseEntrySourcePronunciation(value: unknown, supabaseUrl: string): EntrySourcePronunciation | null {
  const parsed = rowSchema.safeParse(value);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (row.segments.map(part => part.text).join("") !== row.display_ko ||
      row.segments.filter(part => part.stress === "primary").length !== 1) return null;
  let audioUrl: string;
  if (/^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/.test(row.audio_key)) {
    if (!/^mw:[a-f0-9]{20}$/.test(row.variant_id)) return null;
    audioUrl = row.audio_key;
  } else {
    const prefix = "/storage/v1/object/public/vocab-pronunciation-audio/";
    const key = row.audio_key.startsWith(prefix) ? row.audio_key.slice(prefix.length) : "";
    const profile = /\/profile-([a-f0-9]{16})\//.exec(key)?.[1];
    const request = /\/([a-f0-9]{64})\.mp3$/.exec(key)?.[1];
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseUrl) ||
        !profile || !request || row.variant_id !== `synthetic:${request}` ||
        !isVocabPronunciationStorageKey(`profile:${profile}`, request, key, true)) return null;
    audioUrl = supabaseUrl + row.audio_key;
  }
  return { entryId: row.vocab_entry_id, headword: row.headword, pronunciation: {
    displayKo: row.display_ko, segments: row.segments, variantId: row.variant_id, audioUrl, available: true,
  } };
}

export function withEntrySourcePronunciation(selected: QuizPronunciation, context?: EntrySourceContext): QuizPronunciation {
  if (!selected.available || !context?.headword) return selected;
  const matches = context.restorations?.filter(row =>
    row.headword.normalize("NFC").trim().toLowerCase() === context.headword!.normalize("NFC").trim().toLowerCase() &&
    row.pronunciation.available && row.pronunciation.variantId === selected.variantId &&
    row.pronunciation.audioUrl === selected.audioUrl) ?? [];
  if (matches.length !== 1) return selected;
  return { ...selected, displayKo: matches[0].pronunciation.displayKo, segments: matches[0].pronunciation.segments };
}
