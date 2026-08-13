import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const approvedTableMigrationPath = path.resolve(
  "supabase/migrations/20260813203000_add_approved_korean_pronunciation_segments.sql",
);
const validationFixMigrationPath = path.resolve(
  "supabase/migrations/20260813203200_fix_approved_korean_pronunciation_validation.sql",
);
const multiwordStressMigrationPath = path.resolve(
  "supabase/migrations/20260813203300_allow_multiword_primary_stress.sql",
);
const importMigrationPath = path.resolve(
  "supabase/migrations/20260813204000_add_approved_korean_pronunciation_atomic_import.sql",
);

function fixture() {
  const hash = "1".repeat(64);
  const audioHash = "2".repeat(64);
  return {
    assetId: `synthetic:${hash}`,
    audioHash,
    pronunciationPackage: {
      schema_version: "approved-korean-pronunciation-batch-v1",
      package_id: "expression-stress-test-v1",
      status: "approved",
      review_method: "independent_double_review_exact_audio",
      normalization_rule: "korean_display_segment_v1",
      source_audio_profile_id: "profile:5b6efb0ecc8f4702",
      source_audio_manifest_sha256: "3".repeat(64),
      expected_item_count: 1,
      items: [
        {
          dictionary_id: "expression:apply-for-4f26363d",
          headword: "apply for",
          pronunciation_identity_type: "synthetic_asset",
          pronunciation_variant_id: `synthetic:${hash}`,
          display_pronunciation_ko: "어플라이 포어",
          segments: [
            { text: "어플", stress: "none" },
            { text: "라이", stress: "primary" },
            { text: " 포어", stress: "none" },
          ],
          review_status: "approved",
          source_content_sha256: audioHash,
          source_review_run_ids: ["review-a", "review-b"],
          source_review_run_id: "review-a+review-b",
        },
      ],
    },
  };
}

async function setupDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema private;
    create table public.vocab_synthetic_audio_assets (
      asset_id text primary key,
      dictionary_id text not null,
      profile_id text not null,
      speech_text text not null,
      audio_sha256 text not null,
      storage_verified boolean not null,
      playback_enabled boolean not null,
      canonical_pronunciation_approval_implied boolean not null
    );
  `);
  const approvedTableMigration = await readFile(
    approvedTableMigrationPath,
    "utf8",
  );
  const seedMarker = "insert into public.vocab_approved_korean_pronunciations";
  await database.exec(
    approvedTableMigration.slice(0, approvedTableMigration.indexOf(seedMarker)),
  );
  await database.exec(await readFile(validationFixMigrationPath, "utf8"));
  await database.exec(await readFile(multiwordStressMigrationPath, "utf8"));
  await database.exec(await readFile(importMigrationPath, "utf8"));
  return database;
}

describe("approved Korean pronunciation atomic import", () => {
  it("정확한 합성 음원만 원자 등록하고 같은 묶음 재실행은 그대로 둔다", async () => {
    const database = await setupDatabase();
    const { assetId, audioHash, pronunciationPackage } = fixture();
    await database.query(
      `insert into public.vocab_synthetic_audio_assets (
        asset_id,
        dictionary_id,
        profile_id,
        speech_text,
        audio_sha256,
        storage_verified,
        playback_enabled,
        canonical_pronunciation_approval_implied
      ) values ($1, $2, $3, $4, $5, true, true, false)`,
      [
        assetId,
        "expression:apply-for-4f26363d",
        "profile:5b6efb0ecc8f4702",
        "apply for",
        audioHash,
      ],
    );

    const first = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_approved_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(first.rows[0].result).toMatchObject({
      status: "ok",
      itemCount: 1,
      insertedCount: 1,
      verifiedCount: 1,
    });
    const second = await database.query<{ result: Record<string, unknown> }>(
      "select public.import_approved_korean_pronunciation_package_v1($1::jsonb) as result",
      [JSON.stringify(pronunciationPackage)],
    );
    expect(second.rows[0].result).toMatchObject({
      insertedCount: 0,
      verifiedCount: 1,
    });

    const rows = await database.query<{
      dictionary_id: string;
      primary_count: number;
    }>(`
      select
        dictionary_id,
        (
          select count(*)::integer
          from jsonb_array_elements(segments) as segment(value)
          where segment.value ->> 'stress' = 'primary'
        ) as primary_count
      from public.vocab_approved_korean_pronunciations
    `);
    expect(rows.rows).toEqual([
      {
        dictionary_id: "expression:apply-for-4f26363d",
        primary_count: 1,
      },
    ]);
    await database.close();
  });

  it("없는 음원이나 같은 음원에 다른 강세를 넣으면 기존 행을 보존하고 거부한다", async () => {
    const database = await setupDatabase();
    const { assetId, audioHash, pronunciationPackage } = fixture();
    await database.query(
      `insert into public.vocab_synthetic_audio_assets (
        asset_id,
        dictionary_id,
        profile_id,
        speech_text,
        audio_sha256,
        storage_verified,
        playback_enabled,
        canonical_pronunciation_approval_implied
      ) values ($1, $2, $3, $4, $5, true, true, false)`,
      [
        assetId,
        "expression:apply-for-4f26363d",
        "profile:5b6efb0ecc8f4702",
        "apply for",
        audioHash,
      ],
    );
    await database.query(
      "select public.import_approved_korean_pronunciation_package_v1($1::jsonb)",
      [JSON.stringify(pronunciationPackage)],
    );

    const missingStatus: Record<string, unknown> = {
      ...pronunciationPackage,
    };
    delete missingStatus.status;
    await expect(
      database.query(
        "select public.import_approved_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(missingStatus)],
      ),
    ).rejects.toThrow("invalid_approved_korean_pronunciation_package");

    const itemWithoutStatus: Record<string, unknown> = {
      ...pronunciationPackage.items[0],
    };
    delete itemWithoutStatus.review_status;
    const missingItemStatus: Record<string, unknown> = {
      ...pronunciationPackage,
      items: [itemWithoutStatus],
    };
    await expect(
      database.query(
        "select public.import_approved_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(missingItemStatus)],
      ),
    ).rejects.toThrow("invalid_approved_korean_pronunciation_item");

    const changed = structuredClone(pronunciationPackage);
    changed.items[0].segments = [
      { text: "어플", stress: "primary" },
      { text: "라이", stress: "none" },
      { text: " 포어", stress: "none" },
    ];
    await expect(
      database.query(
        "select public.import_approved_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(changed)],
      ),
    ).rejects.toThrow("approved_korean_pronunciation_identity_mismatch");

    const missingAudio = structuredClone(pronunciationPackage);
    missingAudio.items[0].pronunciation_variant_id =
      `synthetic:${"9".repeat(64)}`;
    await expect(
      database.query(
        "select public.import_approved_korean_pronunciation_package_v1($1::jsonb)",
        [JSON.stringify(missingAudio)],
      ),
    ).rejects.toThrow("approved_korean_pronunciation_audio_identity_mismatch");

    const count = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.vocab_approved_korean_pronunciations",
    );
    expect(count.rows).toEqual([{ count: 1 }]);
    await database.close();
  });
});
