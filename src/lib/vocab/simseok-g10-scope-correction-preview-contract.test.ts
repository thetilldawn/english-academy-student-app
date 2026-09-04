import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertSimseokG10ScopeCorrectionPreviewEnvironment,
  SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS,
  SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
  SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS,
  validateSimseokG10ScopeCorrectionPreview,
} from "@/lib/vocab/simseok-g10-scope-correction-preview-contract";

const bundleRoot = path.resolve(
  "../..",
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v3_고1_1_2과_정정",
);
const examDirectory = path.join(bundleRoot, "02_앱전달묶음");
const questionDirectory = path.join(bundleRoot, "03_통합문항_앱전달묶음");

function readInput() {
  return {
    examManifestText: fs.readFileSync(
      path.join(examDirectory, "app-handoff-manifest.json"),
      "utf8",
    ),
    examPackageTexts: new Map(
      SIMSEOK_G10_SCOPE_CORRECTION_EXAM_SETS.map((item) => [
        item.packagePath,
        fs.readFileSync(path.join(examDirectory, item.packagePath), "utf8"),
      ]),
    ),
    questionManifestText: fs.readFileSync(
      path.join(questionDirectory, "combined-question-handoff-manifest.json"),
      "utf8",
    ),
    questionPackageTexts: new Map(
      SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS.map((item) => [
        item.packagePath,
        fs.readFileSync(path.join(questionDirectory, item.packagePath), "utf8"),
      ]),
    ),
    reviewLedgerText: fs.readFileSync(
      path.join(questionDirectory, "independent-review-rejections.json"),
      "utf8",
    ),
  };
}

describe("심석고 고1 공통영어Ⅱ 1·2과 Preview 정정 계약", () => {
  it("여섯 세트를 전부 검산하되 DB 단계 반영은 고1 1·2과만 고정한다", () => {
    const validated = validateSimseokG10ScopeCorrectionPreview(readInput());

    expect(validated.summary).toMatchObject({
      validatedSetCount: 6,
      stagedSetCount: 2,
      sourceOccurrenceCount: 1509,
      stagedOccurrenceCount: 222,
      questionItemCount: 1766,
      expandedQuestionCount: 1771,
      stagedQuestionItemCount: 245,
      stagedExpandedQuestionCount: 249,
      definitionCount: 840,
      exampleCount: 926,
      targetProjectRef: SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
      writes: 0,
    });
    expect(validated.stagedPackages.map((item) => item.setKey)).toEqual([
      "g1_l1",
      "g1_l2",
    ]);
    expect(
      validated.stagedPackages.map((item) => item.examPackage.entries.length),
    ).toEqual([111, 111]);
  });

  it("manifest나 개별 package 한 글자 변조도 로컬에서 먼저 거부한다", () => {
    const manifestTampered = readInput();
    manifestTampered.examManifestText = manifestTampered.examManifestText.replace(
      "[공통영어 II] 오선영 1과 단어",
      "[변조] 오선영 1과 단어",
    );
    expect(() =>
      validateSimseokG10ScopeCorrectionPreview(manifestTampered),
    ).toThrow(/고정 해시/u);

    const packageTampered = readInput();
    const pathToTamper = SIMSEOK_G10_SCOPE_CORRECTION_QUESTION_SETS[3].packagePath;
    const original = packageTampered.questionPackageTexts.get(pathToTamper)!;
    packageTampered.questionPackageTexts.set(
      pathToTamper,
      original.replace("foreign", "tampered-foreign"),
    );
    expect(() =>
      validateSimseokG10ScopeCorrectionPreview(packageTampered),
    ).toThrow(/패키지 해시/u);
  });

  it("Production이나 다른 Supabase 프로젝트로의 실행을 차단한다", () => {
    expect(() =>
      assertSimseokG10ScopeCorrectionPreviewEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          `https://${SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF}.supabase.co`,
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
      }),
    ).toThrow(/Production/u);
    expect(() =>
      assertSimseokG10ScopeCorrectionPreviewEnvironment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://wrong-ref.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          SIMSEOK_G10_SCOPE_CORRECTION_PREVIEW_PROJECT_REF,
      }),
    ).toThrow(/안전장치/u);
  });
});
