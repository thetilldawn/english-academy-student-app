import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260814011550_add_synthetic_word_surface_audio.sql",
  ),
  "utf8",
);

describe("단어 표면형 합성 음원 migration", () => {
  it("word 자산과 표면형·IPA identity를 기존 expression 자산과 함께 허용한다", () => {
    expect(migration).toContain("dictionary_id ~ '^(expression|word):");
    expect(migration).toContain("dictionary_word_surface");
    expect(migration).toContain("occurrence_word_phrase");
    expect(migration).toContain("custom_ipa_word_surface");
    expect(migration).toContain("canonical_ipa text");
    expect(migration).toContain("google_tts_ipa text");
    expect(migration).toContain(
      "unique nulls not distinct (",
    );
    expect(migration).toContain("pronunciation_variant_id");
  });

  it("release와 vocab entry를 DB가 authoritative occurrence에서 해석한다", () => {
    expect(migration).toContain(
      "create function private.resolve_vocab_synthetic_audio_binding_scope_v1()",
    );
    expect(migration).toContain("and occurrence.occurrence_id = new.occurrence_id");
    expect(migration).toContain("and occurrence.dictionary_id = new.dictionary_id");
    expect(migration).toContain("and occurrence.include_in_exam");
    expect(migration).toContain(
      "and asset.speech_text = occurrence.display_headword",
    );
    expect(migration).toContain("unique (release_id, vocab_entry_id)");
  });

  it("단어 28개·29회만 service role RPC로 원자 등록한다", () => {
    expect(migration).toContain(
      "create function private.import_vocab_synthetic_word_audio_package_v1(",
    );
    expect(migration).toContain("or v_asset_count <> 28");
    expect(migration).toContain("or v_occurrence_count <> 29");
    expect(migration).toContain(
      "jsonb_typeof(p_package) is distinct from 'object'",
    );
    expect(migration).toContain(
      "and exam_occurrence.display_headword = item.speech_text",
    );
    expect(migration).toContain("and dictionary_id ~ '^word:'");
    expect(migration).toContain(
      "grant execute on function\n  public.import_vocab_synthetic_word_audio_package_v1(jsonb)\n  to service_role",
    );
    expect(migration).not.toMatch(/grant execute[\s\S]+to (?:anon|authenticated)/i);
  });
});
