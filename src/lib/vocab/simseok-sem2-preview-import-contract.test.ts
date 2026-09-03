import { describe, expect, it } from "vitest";

import {
  assertSimseokSem2PreviewEnvironment,
  SIMSEOK_SEM2_EXPECTED_SETS,
  SIMSEOK_SEM2_HANDOFF_FILE_SHA256,
  SIMSEOK_SEM2_PREVIEW_PROJECT_REF,
  validateSimseokSem2PreviewHandoff,
} from "@/lib/vocab/simseok-sem2-preview-import-contract";

describe("심석고 2학기 Preview 가져오기 계약", () => {
  it("여섯 자료명·개수와 Preview 프로젝트를 고정한다", () => {
    expect(SIMSEOK_SEM2_EXPECTED_SETS.map((item) => item.title)).toEqual([
      "[영어 II] 오선영 1과 단어",
      "[영어 II] 오선영 2과 단어",
      "[심석 고2] 2-1 모고 단어",
      "[공통영어 II] 오선영 3과 단어",
      "[공통영어 II] 오선영 4과 단어",
      "[심석 고1] 2-1 필수 형용사 500",
    ]);
    expect(
      SIMSEOK_SEM2_EXPECTED_SETS.reduce(
        (sum, item) => sum + item.entryCount,
        0,
      ),
    ).toBe(1584);
    expect(SIMSEOK_SEM2_PREVIEW_PROJECT_REF).toBe(
      "wojxpruvbjzbhrpmsbuy",
    );
    expect(SIMSEOK_SEM2_HANDOFF_FILE_SHA256).toHaveLength(64);
  });

  it("Production과 다른 Supabase 프로젝트를 모두 차단한다", () => {
    expect(() =>
      assertSimseokSem2PreviewEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://wojxpruvbjzbhrpmsbuy.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          "wojxpruvbjzbhrpmsbuy",
      }),
    ).toThrow("Production");
    expect(() =>
      assertSimseokSem2PreviewEnvironment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF:
          "wojxpruvbjzbhrpmsbuy",
      }),
    ).toThrow("안전장치");
  });

  it("고정 파일이 아닌 manifest와 경로 우회를 차단한다", () => {
    expect(() =>
      validateSimseokSem2PreviewHandoff("{}", new Map()),
    ).toThrow("고정 해시");
  });
});
