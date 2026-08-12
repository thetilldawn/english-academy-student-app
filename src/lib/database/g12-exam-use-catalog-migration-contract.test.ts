import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260812132000_catalog_g12_exam_use_dataset.sql",
  ),
  "utf8",
);
const itemRangeMigration = readFileSync(
  resolve(
    "supabase/migrations/20260812132100_expand_g12_item_range_labels.sql",
  ),
  "utf8",
);

describe("고3 모의고사 단어장 운영 카탈로그 migration", () => {
  it("가져온 자료를 고3 모의고사와 수능 단위로 자동 등록한다", () => {
    expect(migration).toContain("'고3 모의고사 장문독해'");
    expect(migration).toContain("when unit.unit_label like '%대수능%' then 'csat'");
    expect(migration).toContain("else 'high_mock'");
    expect(migration).toContain("'월 '");
    expect(migration).toContain("' 장문 <'");
    expect(migration).toContain(
      "replace(substring(unit.unit_label from '([0-9]+-[0-9]+)$'), '-', ',')",
    );
  });

  it("연속 문항 범위를 43,44,45처럼 빠짐없이 표시한다", () => {
    expect(itemRangeMigration).toContain(
      "from generate_series(range_start, range_end) as item_number",
    );
    expect(itemRangeMigration).toContain(
      "string_agg(item_number::text, ',' order by item_number)",
    );
    expect(itemRangeMigration).toContain(
      "create trigger vocab_unit_catalog_normalize_g12_display_v1",
    );
  });

  it("새 active 자료판과 이미 있던 자료판을 모두 카탈로그화한다", () => {
    expect(migration).toContain("create trigger app_exam_use_release_catalog_g12_v1");
    expect(migration).toContain("if new.status = 'active' then");
    expect(migration).toContain("where release.dataset_key = 'g12-long-reading-2025-exam-scope-v1'");
    expect(migration).toContain("and release.status = 'active'");
  });
});
