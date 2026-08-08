import { describe, expect, it } from "vitest";

import {
  cleanDatasetTitle,
  datasetDisplayLabel,
  isInternalDatasetEdition,
  storedDatasetDisplayLabel,
} from "@/lib/ui/dataset-display";

describe("dataset display labels", () => {
  it("hides staging release metadata from learner-facing labels", () => {
    expect(
      datasetDisplayLabel(
        "고3 장문독해 2025 승인 Pilot 4 v2",
        "2025-pilot-4-v2",
      ),
    ).toBe("고3 장문독해 2025");
    expect(
      storedDatasetDisplayLabel(
        "고3 장문독해 2025 승인 Pilot 4 v2 · 2025-pilot-4-v2",
      ),
    ).toBe("고3 장문독해 2025");
  });

  it("keeps human-readable editions", () => {
    expect(datasetDisplayLabel("능률 VOCA 어원편 고등", "2025개정")).toBe(
      "능률 VOCA 어원편 고등 · 2025개정",
    );
  });

  it("does not mutate source identity helpers", () => {
    expect(cleanDatasetTitle("  고3 장문독해 2025 승인 Pilot 4 v2  ")).toBe(
      "고3 장문독해 2025",
    );
    expect(isInternalDatasetEdition("2025-pilot-4-v2")).toBe(true);
    expect(isInternalDatasetEdition("2025개정")).toBe(false);
  });
});
