import { createHash } from "node:crypto";

import { SIMSEOK_SEM2_EXPECTED_SETS } from "./simseok-sem2-preview-import-contract";
import { SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS } from "./simseok-sem2-question-preview-import-contract";
import {
  SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS,
  SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS,
} from "./simseok-g10-scope-correction-preview-contract";

export const SIMSEOK_PRODUCTION_PROJECT_REF = "xdxhswjgksukjmpbzqgz";
export const SIMSEOK_PRODUCTION_APPROVAL = "DEPLOY-20260905-01";

// The reviewed Preview contains four original v2 sets and two corrected v3 sets.
// Source approval flags/hashes stay immutable; this is a separate deployment approval.
export const SIMSEOK_PRODUCTION_SETS = [
  ...SIMSEOK_SEM2_EXPECTED_SETS.filter((item) =>
    ["g2_l1", "g2_l2", "g2_mock", "g1_adj500"].includes(item.setKey),
  ).map((exam) => ({
    sourceVersion: "v2_최신범위",
    exam,
    question: SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.find(
      (item) => item.datasetKey === exam.datasetKey,
    )!,
  })),
  ...SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS.filter(
    (item) => item.stageForCutover,
  ).map((exam) => ({
    sourceVersion: "v3_고1_1_2과_정정",
    exam,
    question: SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS.find(
      (item) => item.datasetKey === exam.datasetKey,
    )!,
  })),
] as const;

export function validateSimseokProductionPair(
  datasetKey: string,
  examText: string,
  questionText: string,
) {
  const set = SIMSEOK_PRODUCTION_SETS.find(
    (item) => item.exam.datasetKey === datasetKey,
  );
  if (!set) throw new Error("운영 승인 목록에 없는 시험 자료입니다.");
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  if (
    sha(examText) !== set.exam.packageFileSha256 ||
    sha(questionText) !== set.question.packageFileSha256
  ) throw new Error("운영 승인한 프리뷰 자료와 파일 확인값이 다릅니다.");
  const exam = JSON.parse(examText) as Record<string, unknown>;
  const question = JSON.parse(questionText) as Record<string, unknown>;
  if (
    exam.dataset_key !== datasetKey || question.dataset_key !== datasetKey ||
    exam.package_version !== set.exam.packageVersion ||
    !Array.isArray(exam.entries) || exam.entries.length !== set.exam.entryCount
  ) throw new Error("운영 자료의 범위 또는 개수가 다릅니다.");
  return set;
}
