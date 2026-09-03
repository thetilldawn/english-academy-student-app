import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS,
  validateSimseokCombinedQuestionPreviewHandoff,
} from "@/lib/vocab/simseok-sem2-question-preview-import-contract";

const handoffDirectory = path.resolve(
  "../..",
  "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험/v2_최신범위/03_통합문항_앱전달묶음",
);
const hasLocalHandoff = fs.existsSync(
  path.join(handoffDirectory, "combined-question-handoff-manifest.json"),
);
const describeWithHandoff = hasLocalHandoff ? describe : describe.skip;

function loadHandoff() {
  const manifestText = fs.readFileSync(
    path.join(handoffDirectory, "combined-question-handoff-manifest.json"),
    "utf8",
  );
  const reviewLedgerText = fs.readFileSync(
    path.join(handoffDirectory, "independent-review-rejections.json"),
    "utf8",
  );
  const packageTexts = new Map(
    SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS.map((item) => [
      item.packagePath,
      fs.readFileSync(path.join(handoffDirectory, item.packagePath), "utf8"),
    ]),
  );
  return { manifestText, reviewLedgerText, packageTexts };
}

describeWithHandoff("심석고 통합 문항 Preview 가져오기 계약", () => {
  it("검토에서 탈락시킨 문항을 빼고 두 시험 유형을 함께 고정한다", () => {
    const loaded = loadHandoff();
    const validated = validateSimseokCombinedQuestionPreviewHandoff(
      loaded.manifestText,
      loaded.packageTexts,
      loaded.reviewLedgerText,
    );
    expect(validated.summary).toMatchObject({
      setCount: 6,
      itemCount: 1995,
      expandedCount: 1996,
      definitionCount: 942,
      exampleCount: 1053,
      rejectedCount: 265,
      writes: 0,
    });
  });

  it("검토 탈락 기록 한 글자 변조도 거부한다", () => {
    const loaded = loadHandoff();
    expect(() =>
      validateSimseokCombinedQuestionPreviewHandoff(
        loaded.manifestText,
        loaded.packageTexts,
        loaded.reviewLedgerText.replace("raw_first_sense", "raw_other_sense"),
      ),
    ).toThrow(/검토 연결 해시/u);
  });

  it("문항 파일 한 글자 변조도 거부한다", () => {
    const loaded = loadHandoff();
    const expected = SIMSEOK_COMBINED_QUESTION_EXPECTED_SETS[0];
    loaded.packageTexts.set(
      expected.packagePath,
      loaded.packageTexts.get(expected.packagePath)!.replace(
        "canonical_definition_to_headword",
        "canonical_example_to_headword",
      ),
    );
    expect(() =>
      validateSimseokCombinedQuestionPreviewHandoff(
        loaded.manifestText,
        loaded.packageTexts,
        loaded.reviewLedgerText,
      ),
    ).toThrow(/파일 해시/u);
  });
});
