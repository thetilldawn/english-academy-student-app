import { describe, expect, it } from "vitest";
import { libraryResourceSchema, librarySelectedResourceV2Schema, learningPronunciationSchema } from "./library-resources";

const pronunciation = { displayKo: "테스트", variantId: "fake:variant", audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test001.mp3", available: true,
  segments: [{ text: "테", stress: "primary" }, { text: "스트", stress: "none" }] };
const selected = { schemaVersion: "vocabulary-resource-selected-v2", pronunciation, lexicalPos: "noun", dictionary: { dictionary_id: "word:fake", sense_id: null, canonical_approved: false },
  senseId: null, definitionEn: "A fake definition.", exampleEn: "A fake example.", exampleKo: "가짜 예문.", proofs: {} };
describe("versioned selected vocabulary resources", () => {
  it("preserves nonempty selected fields and uses an explicit version without invented proof values", () => {
    expect(librarySelectedResourceV2Schema.parse(selected)).toEqual(selected);
    const legacy = { ...selected, schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: { headword: "test" } };
    expect(libraryResourceSchema.parse(legacy)).toEqual(legacy);
    expect(libraryResourceSchema.safeParse({ ...selected, sourceFields: {} }).success).toBe(false);
    expect(libraryResourceSchema.safeParse({ ...selected, schemaVersion: "vocabulary-resource-ref-v2" }).success).toBe(false);
  });
  it("keeps review references and forbids missing linked proof references or copied bodies", () => {
    const ref = { fileHash: "a".repeat(64), valueHash: "b".repeat(64), pointer: "/fake/1", line: 1 };
    expect(libraryResourceSchema.parse({ ...selected, proofs: { audio: { state: "review_required", ref } } })).toMatchObject({ proofs: { audio: { ref } } });
    for (const proofs of [{ audio: { state: "linked", ref: null } }, { audio: { state: "linked", ref, value: "raw body" } }, { arbitrary: { state: "absent", ref: null } }]) {
      expect(libraryResourceSchema.safeParse({ ...selected, proofs }).success).toBe(false);
    }
    expect(libraryResourceSchema.safeParse({ ...selected, dictionary: { ...selected.dictionary, raw: "dictionary body" } }).success).toBe(false);
  });
  it.each(["..", ".", "%2e", ".%2E", "%2e.", "%2e%2e"])("rejects escaping audio segment %s without changing historical v1", segment => {
    const audioUrl = `https://${"a".repeat(20)}.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/${segment}/fake.mp3`;
    expect(learningPronunciationSchema.safeParse({ ...pronunciation, audioUrl }).success).toBe(false);
  });
  it("preserves the old URL spelling contract but narrows v2 to the checked literal paths", () => {
    const audioUrl = `https://${"a".repeat(20)}.supabase.co:443/storage/v1/object/public/vocab-pronunciation-audio/fake.mp3`;
    const legacy = { ...selected, pronunciation: { ...pronunciation, audioUrl }, schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {} };
    expect(libraryResourceSchema.safeParse(legacy).success).toBe(true);
    expect(libraryResourceSchema.safeParse({ ...legacy, schemaVersion: "vocabulary-resource-selected-v2", sourceFields: undefined }).success).toBe(false);
    expect(learningPronunciationSchema.safeParse({ ...pronunciation, audioUrl }).success).toBe(false);
  });
});
