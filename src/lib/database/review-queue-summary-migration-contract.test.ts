import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730213000_list_review_queue_summaries.sql",
  ),
  "utf8",
);

describe("review queue summary migration", () => {
  it("pending을 학생·단어장별로 예약 포함/제외 가능하게 집계한다", () => {
    expect(migration).toContain(
      "public.list_student_vocab_review_queue_summaries(",
    );
    expect(migration).toContain(
      "(queue.student_id, queue.dataset_id)",
    );
    expect(migration).toContain(
      "> (p_after_student_id, p_after_dataset_id)",
    );
    expect(migration).toContain("limit p_limit");
    expect(migration).toContain(
      "p_limit not between 1 and 500",
    );
    expect(migration).toContain("where queue.status = 'pending'");
    expect(migration).toContain(
      "group by queue.student_id, queue.dataset_id",
    );
    expect(migration).toContain(
      "and queue.reserved_review_draft_id is not null",
    );
    expect(migration).toContain("pending_level_1_count");
    expect(migration).toContain("pending_level_2_count");
    expect(migration).toContain("reserved_level_1_count");
    expect(migration).toContain("reserved_level_2_count");
  });

  it("invoker RLS를 유지하고 익명 실행을 허용하지 않는다", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "from public, anon, authenticated",
    );
    expect(migration).toContain("to authenticated");
  });
});
