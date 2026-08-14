import { describe, expect, it } from "vitest";

import {
  assertPreviewEnvironment,
  getSupabaseProjectRef,
} from "../../../scripts/verify-preview-environment.mjs";

describe("Vercel Supabase environment guard", () => {
  it("extracts only a canonical Supabase project ref", () => {
    expect(
      getSupabaseProjectRef("https://wojxpruvbjzbhrpmsbuy.supabase.co"),
    ).toBe("wojxpruvbjzbhrpmsbuy");
    expect(getSupabaseProjectRef("https://example.com")).toBeNull();
  });

  it("blocks Preview when its configured project ref differs", () => {
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
        PREVIEW_EXPECTED_SUPABASE_PROJECT_REF: "wojxpruvbjzbhrpmsbuy",
      }),
    ).toThrow("Preview build blocked");
  });

  it("blocks Production unless it uses the fixed Production project", () => {
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      }),
    ).toThrow("Production build blocked");
    expect(() =>
      assertPreviewEnvironment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL:
          "https://xdxhswjgksukjmpbzqgz.supabase.co",
      }),
    ).not.toThrow();
  });
});
