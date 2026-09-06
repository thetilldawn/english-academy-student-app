import { describe, expect, it } from "vitest";
import { isVocabPronunciationStorageKey } from "./pronunciation-storage";

describe("approved pronunciation storage", () => {
  const hash = "a".repeat(64);
  const key = (profile: string, scope = "") =>
    `pronunciation/google_cloud_text_to_speech/${profile.replace(":", "-")}/${scope}${hash}.mp3`;
  it.each(["profile:75ca7f418d66e6ab", "profile:1a77d56d47e26013"])("keeps %s VOCA objects", (profile) => {
    expect(isVocabPronunciationStorageKey(profile, hash, key(profile, "ability-voca-etymology-2025-v1/"))).toBe(true);
  });
  it.each(["profile:1a77d56d47e26013", "profile:286866721f7f4ee8"])("accepts only opt-in normal-rate %s objects", (profile) => {
    expect(isVocabPronunciationStorageKey(profile, hash, key(profile))).toBe(false);
    expect(isVocabPronunciationStorageKey(profile, hash, key(profile), true)).toBe(true);
    for (const bad of [key(profile) + "?x", "https://example.com/" + key(profile), key(profile, "../"), key(profile).replace(hash, "b".repeat(64))]) {
      expect(isVocabPronunciationStorageKey(profile, hash, bad, true)).toBe(false);
    }
  });
  it("rejects unknown/slow generic profiles and invalid hashes", () => {
    for (const profile of ["profile:unknown", "profile:75ca7f418d66e6ab", "profile:5b6efb0ecc8f4702"]) {
      expect(isVocabPronunciationStorageKey(profile, hash, key(profile), true)).toBe(false);
    }
    expect(isVocabPronunciationStorageKey("profile:1a77d56d47e26013", "bad", key("profile:1a77d56d47e26013"), true)).toBe(false);
  });
});
