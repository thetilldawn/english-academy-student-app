import { describe, expect, it } from "vitest";

import {
  assertPreviewEnvironment,
  getSupabaseProjectRef,
} from "../../scripts/verify-preview-environment.mjs";

describe("Preview Supabase safety guard", () => {
  it("extracts only a valid Supabase project ref", () => {
    expect(
      getSupabaseProjectRef("https://wojxpruvbjzbhrpmsbuy.supabase.co"),
    ).toBe("wojxpruvbjzbhrpmsbuy");
    expect(getSupabaseProjectRef("https://example.com")).toBeNull();
  });

  it("allows a matching Preview database", () => {
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "preview",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF: "wojxpruvbjzbhrpmsbuy",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      }),
    ).not.toThrow();
  });

  it("blocks a mismatched Preview database", () => {
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "preview",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF: "wojxpruvbjzbhrpmsbuy",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
      }),
    ).toThrow(/ref mismatch/);
  });

  it("does not alter Production builds", () => {
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
      }),
    ).not.toThrow();
  });
});
