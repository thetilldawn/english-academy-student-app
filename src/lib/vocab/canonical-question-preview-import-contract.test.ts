import { describe, expect, it } from "vitest";

import {
  CANONICAL_QUESTION_PREVIEW_MANIFEST_FILE_SHA256,
  CANONICAL_QUESTION_PREVIEW_PACKAGE_FILE_SHA256,
  CANONICAL_QUESTION_PREVIEW_PROJECT_REF,
  projectRefFromSupabaseUrl,
  validateCanonicalQuestionPreviewImport,
} from "./canonical-question-preview-import-contract";

describe("canonical question Preview import contract", () => {
  it("locks the two transferred files and the Preview project", () => {
    expect(CANONICAL_QUESTION_PREVIEW_MANIFEST_FILE_SHA256).toBe(
      "825c6873f2d1788a471af04f28531ba44b004b9d71285729bccc1c30049841cd",
    );
    expect(CANONICAL_QUESTION_PREVIEW_PACKAGE_FILE_SHA256).toBe(
      "e3a170879e18b233fcd6cd5e740bc0c09fd4a42cbf5d694a226d71159602e28a",
    );
    expect(CANONICAL_QUESTION_PREVIEW_PROJECT_REF).toBe(
      "wojxpruvbjzbhrpmsbuy",
    );
  });

  it("extracts only a Supabase project ref", () => {
    expect(
      projectRefFromSupabaseUrl(
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toBe(CANONICAL_QUESTION_PREVIEW_PROJECT_REF);
    expect(projectRefFromSupabaseUrl("https://example.com")).toBeNull();
    expect(
      projectRefFromSupabaseUrl(
        "https://wojxpruvbjzbhrpmsbuy.supabase.co.evil.example",
      ),
    ).toBeNull();
    expect(
      projectRefFromSupabaseUrl(
        "https://wojxpruvbjzbhrpmsbuy.attacker.supabase.co",
      ),
    ).toBeNull();
    expect(
      projectRefFromSupabaseUrl(
        "http://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toBeNull();
    expect(projectRefFromSupabaseUrl("not a URL")).toBeNull();
  });

  it("rejects a re-serialized manifest even when it declares fixed inner hashes", () => {
    const forgedManifest = JSON.stringify({
      package_file_sha256: CANONICAL_QUESTION_PREVIEW_PACKAGE_FILE_SHA256,
      package_content_hash:
        "45156c1a74b6ffb32694520899b3a9e4ae22840d61e49b049a1650b337b9e1a0",
      content_hash:
        "b3427ba68fb16f03313ebb5c76a6fe39d2150ac205ab6c917770735124013973",
    });
    expect(() =>
      validateCanonicalQuestionPreviewImport(forgedManifest, ""),
    ).toThrow("manifest 파일의 고정 해시");
  });
});
