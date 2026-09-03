import { createHash } from "node:crypto";

import { z } from "zod";

import {
  type ExamUsePackage,
  supabaseProjectRef,
  validateExamUsePackage,
} from "@/lib/vocab/exam-use-import-contract";

export const SIMSEOK_SEM2_PREVIEW_PROJECT_REF =
  "wojxpruvbjzbhrpmsbuy";
export const SIMSEOK_SEM2_HANDOFF_FILE_SHA256 =
  "7834bb3412f19dac491457d546c4c6854f7f5d37315311c10a25550797698664";
export const SIMSEOK_SEM2_HANDOFF_CONTENT_HASH =
  "de83b9b0a17de2f4d3869c9bddc231dcf77cea15c0839dedcf283a2e6f8d8951";
export const SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256 =
  "1b197a1066283422f6c30b9a08d0c93cfc986bbf41258443b7a0569ea86f820d";
export const SIMSEOK_SEM2_SCOPE_STATUS =
  "user_directed_operational_scope_not_officially_confirmed";

export const SIMSEOK_SEM2_EXPECTED_SETS = [
  {
    setKey: "g2_l1",
    datasetKey: "simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1",
    title: "[영어 II] 오선영 1과 단어",
    entryCount: 320,
    packagePath:
      "exam-use-packages/simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1.json",
    packageFileSha256:
      "c50ab74358a9c17f85b45a9f998bb68bf879386f6121817624dc9d3e5dfec5c5",
    packageVersion:
      "27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb",
  },
  {
    setKey: "g2_l2",
    datasetKey: "simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1",
    title: "[영어 II] 오선영 2과 단어",
    entryCount: 189,
    packagePath:
      "exam-use-packages/simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1.json",
    packageFileSha256:
      "4a0970994423cd9d412c26824a90c1b13fb16a25422d16ca3ee8de843910eba8",
    packageVersion:
      "d86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0",
  },
  {
    setKey: "g2_mock",
    datasetKey: "simseok-g11-sem2-mid-mock-v1",
    title: "[심석 고2] 2-1 모고 단어",
    entryCount: 278,
    packagePath: "exam-use-packages/simseok-g11-sem2-mid-mock-v1.json",
    packageFileSha256:
      "42a35b8f02be69664d0c9f80d7783b80d0c76f62bce5ad965f94a9b12f355155",
    packageVersion:
      "120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c",
  },
  {
    setKey: "g1_l3",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1",
    title: "[공통영어 II] 오선영 3과 단어",
    entryCount: 169,
    packagePath:
      "exam-use-packages/simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1.json",
    packageFileSha256:
      "9e83c757ea404e14978166458550e106fb648b1e1e9042b93b48bb2c30d9ec99",
    packageVersion:
      "f7492c56b587917deb535a5da971bbdaa78f4c64f1cd26a0fea73af0c969eca9",
  },
  {
    setKey: "g1_l4",
    datasetKey:
      "simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1",
    title: "[공통영어 II] 오선영 4과 단어",
    entryCount: 128,
    packagePath:
      "exam-use-packages/simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1.json",
    packageFileSha256:
      "2ea8d28fb84202964062aeafbf95cd6fecc67f3bc9c23d67c92c9dd3742fa512",
    packageVersion:
      "d5895f920dedf4327b4d615d88ccdb52fdf9a6ebcc7435f1eca7cfe6359cdcb3",
  },
  {
    setKey: "g1_adj500",
    datasetKey: "simseok-g10-sem2-mid-adjective-500-v1",
    title: "[심석 고1] 2-1 필수 형용사 500",
    entryCount: 500,
    packagePath:
      "exam-use-packages/simseok-g10-sem2-mid-adjective-500-v1.json",
    packageFileSha256:
      "34f3d61874c971e23ddd971a1b7311c7f37d34e33e28555dec772da3bf811514",
    packageVersion:
      "95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e",
  },
] as const;

const sha256Schema = z.string().regex(/^[0-9A-Fa-f]{64}$/u);
const unitCountsSchema = z.record(z.string().min(1), z.number().int().positive());

const handoffSetSchema = z
  .object({
    set_key: z.string().min(1),
    dataset_key: z.string().min(1),
    display_name: z.string().min(1),
    entry_count: z.number().int().positive(),
    package_path: z.string().min(1),
    package_file_sha256: sha256Schema,
    package_version: sha256Schema,
    unit_counts: unitCountsSchema,
    catalog: z
      .object({
        academic_year: z.null(),
        curriculum_revision: z.null(),
        edition_label: z.null(),
        catalog_group: z.literal("high"),
        grade_code: z.enum(["g10", "g11"]),
        is_assignable: z.literal(true),
        material_kind: z.enum(["textbook", "exam_prep", "wordbook"]),
        metadata: z
          .object({
            bundleManifestSha256: sha256Schema,
            productionAllowed: z.literal(false),
            school: z.literal("심석고등학교"),
            schoolYear: z.literal(2026),
            scopeStatus: z.literal(SIMSEOK_SEM2_SCOPE_STATUS),
            semester: z.literal(2),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const handoffManifestSchema = z
  .object({
    schema_version: z.literal("simseok-sem2-app-handoff-v2"),
    target_environment: z.literal("preview"),
    target_project_ref: z.literal(SIMSEOK_SEM2_PREVIEW_PROJECT_REF),
    scope_status: z.literal(SIMSEOK_SEM2_SCOPE_STATUS),
    canonical_approved: z.literal(false),
    production_allowed: z.literal(false),
    source_occurrence_count: z.literal(1584),
    set_count: z.literal(6),
    source_bundle_manifest_sha256: sha256Schema,
    content_hash: sha256Schema,
    question_packages: z.object({
      status: z.literal(
        "pending_combined_definition_example_review",
      ),
      writes: z.literal(0),
    }),
    sets: z.array(handoffSetSchema).length(6),
  })
  .passthrough();

export type SimseokSem2ValidatedPackage = {
  setKey: (typeof SIMSEOK_SEM2_EXPECTED_SETS)[number]["setKey"];
  packagePath: string;
  packageFileSha256: string;
  package: ExamUsePackage;
};

export function sha256Utf8(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertSafeRelativePackagePath(value: string) {
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error("앱 전달 묶음에 안전하지 않은 파일 경로가 있습니다.");
  }
}

export function validateSimseokSem2PreviewHandoff(
  manifestText: string,
  packageTexts: ReadonlyMap<string, string>,
) {
  if (sha256Utf8(manifestText) !== SIMSEOK_SEM2_HANDOFF_FILE_SHA256) {
    throw new Error("심석고 앱 전달 manifest 파일의 고정 해시가 다릅니다.");
  }

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(manifestText) as unknown;
  } catch (error) {
    throw new Error("심석고 앱 전달 manifest를 읽지 못했습니다.", {
      cause: error,
    });
  }
  const manifest = handoffManifestSchema.parse(parsedInput);
  if (
    manifest.content_hash.toLowerCase() !==
      SIMSEOK_SEM2_HANDOFF_CONTENT_HASH ||
    manifest.source_bundle_manifest_sha256.toLowerCase() !==
      SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256
  ) {
    throw new Error("심석고 앱 전달 묶음의 원본 연결 해시가 다릅니다.");
  }

  const packages: SimseokSem2ValidatedPackage[] = [];
  for (const [index, expected] of SIMSEOK_SEM2_EXPECTED_SETS.entries()) {
    const declared = manifest.sets[index];
    assertSafeRelativePackagePath(declared.package_path);
    if (
      declared.set_key !== expected.setKey ||
      declared.dataset_key !== expected.datasetKey ||
      declared.display_name !== expected.title ||
      declared.entry_count !== expected.entryCount ||
      declared.package_path !== expected.packagePath ||
      declared.package_file_sha256.toLowerCase() !==
        expected.packageFileSha256 ||
      declared.package_version.toLowerCase() !== expected.packageVersion ||
      declared.catalog.metadata.bundleManifestSha256.toLowerCase() !==
        SIMSEOK_SEM2_SOURCE_BUNDLE_MANIFEST_SHA256
    ) {
      throw new Error(`${expected.title}의 고정 명세가 다릅니다.`);
    }

    const packageText = packageTexts.get(expected.packagePath);
    if (packageText === undefined) {
      throw new Error(`${expected.title} 패키지 파일이 없습니다.`);
    }
    if (sha256Utf8(packageText) !== expected.packageFileSha256) {
      throw new Error(`${expected.title} 패키지 파일 해시가 다릅니다.`);
    }

    const validated = validateExamUsePackage(
      JSON.parse(packageText) as unknown,
    );
    const examUsePackage = validated.package;
    const actualUnitCounts = Object.fromEntries(
      [...new Set(examUsePackage.entries.map((entry) => entry.unit))].map(
        (unit) => [
          unit,
          examUsePackage.entries.filter((entry) => entry.unit === unit).length,
        ],
      ),
    );
    if (
      examUsePackage.dataset_key !== expected.datasetKey ||
      examUsePackage.title !== expected.title ||
      examUsePackage.package_version !== expected.packageVersion ||
      validated.summary.occurrenceCount !== expected.entryCount ||
      validated.summary.includedCount !== expected.entryCount ||
      validated.summary.reviewRequiredCount !== 0 ||
      validated.summary.excludedCount !== 0 ||
      JSON.stringify(actualUnitCounts) !== JSON.stringify(declared.unit_counts) ||
      examUsePackage.entries.some(
        (entry) =>
          !entry.manual_review_flags.includes(
            "official_school_range_not_locally_confirmed",
          ) ||
          entry.context_evidence.scope_status !== SIMSEOK_SEM2_SCOPE_STATUS,
      )
    ) {
      throw new Error(`${expected.title} 패키지 내용 검증 수치가 다릅니다.`);
    }
    packages.push({
      setKey: expected.setKey,
      packagePath: expected.packagePath,
      packageFileSha256: expected.packageFileSha256,
      package: examUsePackage,
    });
  }

  if (packageTexts.size !== SIMSEOK_SEM2_EXPECTED_SETS.length) {
    throw new Error("심석고 앱 전달 폴더에 예상하지 않은 패키지가 있습니다.");
  }

  return {
    manifest,
    packages,
    summary: {
      setCount: packages.length,
      occurrenceCount: packages.reduce(
        (sum, item) => sum + item.package.entries.length,
        0,
      ),
      targetProjectRef: manifest.target_project_ref,
      scopeStatus: manifest.scope_status,
      writes: 0,
    },
  };
}

export function assertSimseokSem2PreviewEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.VERCEL_ENV === "production") {
    throw new Error("Production 환경에는 심석고 검토본을 가져올 수 없습니다.");
  }
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const actualProjectRef = supabaseProjectRef(supabaseUrl);
  const expectedProjectRef =
    environment.PREVIEW_EXPECTED_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (
    actualProjectRef !== SIMSEOK_SEM2_PREVIEW_PROJECT_REF ||
    expectedProjectRef !== SIMSEOK_SEM2_PREVIEW_PROJECT_REF
  ) {
    throw new Error("심석고 검토본의 Preview 프로젝트 안전장치가 다릅니다.");
  }
  return { supabaseUrl, projectRef: actualProjectRef };
}
