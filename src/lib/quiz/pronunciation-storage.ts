const REQUEST_HASH = /^[0-9a-f]{64}$/;
const LEGACY_WORD_PROFILES = new Set([
  "profile:75ca7f418d66e6ab", "profile:1a77d56d47e26013",
]);
const NORMAL_PROFILES = new Set([
  "profile:1a77d56d47e26013", "profile:286866721f7f4ee8",
]);

// Runtime and import contracts share exact path checks, never an arbitrary URL prefix.
export function isVocabPronunciationStorageKey(
  profileId: string, requestHash: string, objectKey: unknown,
  allowSharedNormalRate = false,
) {
  if (!REQUEST_HASH.test(requestHash)) return false;
  const base = `pronunciation/google_cloud_text_to_speech/${profileId.replace(":", "-")}/`;
  return (LEGACY_WORD_PROFILES.has(profileId) &&
    objectKey === `${base}ability-voca-etymology-2025-v1/${requestHash}.mp3`) ||
    (allowSharedNormalRate && NORMAL_PROFILES.has(profileId) &&
      objectKey === `${base}${requestHash}.mp3`);
}
