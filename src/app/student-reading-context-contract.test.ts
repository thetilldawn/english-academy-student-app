import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const service = fs.readFileSync(
  path.resolve("src/lib/services/student-reading-context-service.ts"),
  "utf8",
);

describe("manual student reading-context sync", () => {
  it("keeps full wrong counts and validates Drive file ownership", () => {
    expect(service).toContain("wrong_count_snapshot");
    expect(service).toContain("wrong_count:");
    expect(service).toContain("wrong_level: item.wrong_level");
    expect(service).toContain("drive_file_identity_mismatch");
    expect(service).toContain("reading_context_latest_request_id");
    expect(service).toContain("reading_context_sync_started_at");
  });
});
