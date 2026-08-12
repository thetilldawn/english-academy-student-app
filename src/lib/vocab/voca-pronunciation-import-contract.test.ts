import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateVocaPronunciationPackage } from "@/lib/vocab/voca-pronunciation-import-contract";

const packagePath = resolve(
  "../../영어/90_이관 기록/단어시스템/app_bridge/ability-voca-etymology-2025/20260812_pronunciation_v1/webster-raw-audio-package.json",
);

describe("VOCA Webster raw 발음 연결 자료", () => {
  it("3,001행과 재생·보충·검토 수치를 해시까지 검증한다", () => {
    const input = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
    const result = validateVocaPronunciationPackage(input);
    expect(result.summary).toEqual({
      total_rows: 3001,
      unique_headwords: 2820,
      playable_rows: 2525,
      playable_unique_headwords: 2350,
      api_lookup_required_rows: 476,
      needs_review_rows: 316,
    });
    expect(result.package.package_version).toBe(
      "F9209B8349B71B39548D1C5EE756414B12B55F7C8DC7049798A6A4CAC6DE1E26",
    );
  });
});
