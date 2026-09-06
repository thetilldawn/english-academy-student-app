import { SIMSEOK_PRODUCTION_SETS } from "./simseok-production-release-contract";
import { validateScopedPronunciationRelease } from "./vocab-pronunciation-release-v2-contract";

// Approved dataset exports, not semantic source files or word content.
const SOURCES: Readonly<Record<string, string>> = {
  "simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1": "039D9B3B5F2082F707830258A5A47280C36666A59DB53005012D27287FD050F1",
  "simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1": "5E6AEE5AFDE8A44C6685E6FF92109FB3D300BCB856F0B7C942D9AB0E3686C8CB",
  "simseok-g10-sem2-mid-adjective-500-v1": "A7891662F732A57C4F9ADE87E73D82875DB61C44760BCC0C57A863353DB428C5",
  "simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1": "6876434435288010C844406C78C1C43B8AC3AB550A3FAC4C06A043F84536EBB4",
  "simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1": "9384C2D8AA8D25C88F87444FC3D78570660B39CD8F2D9C844A7BB4D977EAAF08",
  "simseok-g11-sem2-mid-mock-v1": "22DB0FFA49960DCF28C6B612203364A664B4C83378366F26E538A6D42457F17F"
};

export const SCHOOL_PRONUNCIATION_SCOPES = SIMSEOK_PRODUCTION_SETS.map(({ exam }) => ({
  datasetKey: exam.datasetKey, sourceSha256: SOURCES[exam.datasetKey],
  entryCount: exam.entryCount, allowSharedNormalRate: true,
}));

export function validateSchoolPronunciationRelease(input: unknown) {
  const datasetKey = input !== null && typeof input === "object" && "dataset_key" in input
    ? input.dataset_key : undefined;
  const scope = SCHOOL_PRONUNCIATION_SCOPES.find((item) => item.datasetKey === datasetKey);
  if (!scope || !scope.sourceSha256) throw new Error("발음 연결을 승인한 학교 자료가 아닙니다.");
  return validateScopedPronunciationRelease(input, scope);
}
