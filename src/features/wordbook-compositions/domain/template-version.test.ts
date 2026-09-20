import { describe, expect, it } from "vitest";
import { compareLibraryVersions, editTemplateMetadata, latestLibraryVersion, matchesTemplate } from "./template-version";
import { EMPTY_LIBRARY_FILTERS, libraryTemplateSchema } from "../contracts/library";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const template = () => libraryTemplateSchema.parse({ id: id(1), revision: 1,
  metadata: { title: "가짜 학교", tags: ["직전 대비"], school: "가짜고", targetGrade: "g11", schoolYear: 2026, semester: 2, assessment: "기말", purpose: "시험 준비" },
  versions: [{ id: id(2), number: 1, contentHash: "a".repeat(64), recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" }, includedKeys: [], sourceCount: 0, sourceVersionId: null, datasetId: null, createdAt: "2026-09-20T00:00:00Z" }],
});
describe("template presentation and history", () => {
  it("edits discovery metadata without changing the fixed version and finds structured context plus tags", () => {
    const original = template();
    const renamed = editTemplateMetadata(original, { ...original.metadata, title: "복습 틀", tags: ["수업"] });
    expect(renamed.versions).toBe(original.versions);
    expect(matchesTemplate(renamed, "가짜고 2026 2학기 수업")).toBe(true);
    expect(matchesTemplate(renamed, "직전 대비")).toBe(false);
    expect(latestLibraryVersion(renamed).datasetId).toBeNull();
  });
  it("reports actual row additions/removals separately from changed order", () => {
    expect(compareLibraryVersions({ includedKeys: ["a", "b", "c"] }, { includedKeys: ["c", "a", "d"] }))
      .toEqual({ added: ["d"], removed: ["b"], orderChanged: true });
    expect(compareLibraryVersions({ includedKeys: ["a", "b"] }, { includedKeys: ["a", "b", "c"] }).orderChanged).toBe(false);
  });
});
