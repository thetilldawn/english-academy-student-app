import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { sha256 } from "@/lib/vocab/canonical-linkage";
import { normalizeVocabularyImport } from "@/lib/vocab/import-contract";

type ManifestFile = {
  file: string;
  rows: number;
  sha256: string;
};

type Manifest = {
  schemaVersion: number;
  dataset: {
    datasetKey: string;
    sourceSha256: string;
    expectedRows: number;
  };
  counts: {
    exactLinkedRows: number;
    unresolvedRows: number;
    ambiguousRows: number;
    exactLinkedUniqueHeadwords: number;
    unresolvedUniqueHeadwords: number;
  };
  files: ManifestFile[];
  packageSnapshotSha256: string;
};

type LinkRow = {
  sourceRow: number;
  entryRowSha256: string;
  normalizedHeadword: string;
  mappingStatus:
    | "exact_headword_unreviewed"
    | "ambiguous"
    | "unresolved";
  lexemeId: string | null;
};

type OccurrenceRow = {
  lexeme_id: string;
  sense_id: string | null;
  item_label: string;
  mapping_status: string;
};

function parseOptions(args: string[]) {
  let packageDir = "";
  let dataset = "";
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--package-dir" && value) {
      packageDir = value;
    } else if (key === "--dataset" && value) {
      dataset = value;
    } else {
      throw new Error(
        "사용법: npm run verify:vocab-link -- --package-dir <패키지> --dataset <검수본.json>",
      );
    }
  }
  if (!packageDir || !dataset) {
    throw new Error("--package-dir와 --dataset이 필요합니다.");
  }
  return {
    packageDir: path.resolve(packageDir),
    dataset: path.resolve(dataset),
  };
}

async function fileSha256(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function countRows(filePath: string) {
  const text = await fs.readFile(filePath, "utf8");
  if (filePath.endsWith(".jsonl")) {
    return text.split(/\r?\n/).filter(Boolean).length;
  }
  if (filePath.endsWith(".csv")) {
    return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
  }
  return 1;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(options.packageDir, "manifest.json"),
      "utf8",
    ),
  ) as Manifest;
  const dataset = normalizeVocabularyImport(
    JSON.parse(await fs.readFile(options.dataset, "utf8")),
  );

  assert(manifest.schemaVersion === 1, "manifest schemaVersion 불일치");
  assert(
    manifest.dataset.datasetKey === dataset.file.dataset.datasetKey,
    "데이터셋 키 불일치",
  );
  assert(
    manifest.dataset.sourceSha256 ===
      dataset.file.dataset.sourceSha256.toUpperCase(),
    "데이터셋 원본 SHA 불일치",
  );

  const verifiedFiles = [];
  for (const file of manifest.files) {
    const filePath = path.join(options.packageDir, file.file);
    const actualSha256 = await fileSha256(filePath);
    const actualRows = await countRows(filePath);
    assert(
      actualSha256 === file.sha256,
      `${file.file} SHA 불일치`,
    );
    assert(actualRows === file.rows, `${file.file} 행 수 불일치`);
    verifiedFiles.push({
      file: file.file,
      rows: actualRows,
      sha256: actualSha256,
    });
  }

  assert(
    sha256(
      verifiedFiles.map((file) => [file.file, file.rows, file.sha256]),
    ) === manifest.packageSnapshotSha256,
    "패키지 스냅샷 SHA 불일치",
  );

  const links = await readJsonLines<LinkRow>(
    path.join(options.packageDir, "entry_lexeme_link.jsonl"),
  );
  assert(links.length === dataset.entries.length, "연결명세 전체 행 수 불일치");
  const linksByRow = new Map(links.map((link) => [link.sourceRow, link]));
  assert(linksByRow.size === links.length, "연결명세 sourceRow 중복");
  for (const entry of dataset.entries) {
    const link = linksByRow.get(entry.sourceRow);
    assert(link, `연결명세 ${entry.sourceRow}행 누락`);
    assert(
      link.entryRowSha256 === entry.rowSha256,
      `연결명세 ${entry.sourceRow}행 SHA 불일치`,
    );
    if (link.mappingStatus === "exact_headword_unreviewed") {
      assert(link.lexemeId, `정확연결 ${entry.sourceRow}행 lexeme 누락`);
    } else {
      assert(
        link.lexemeId === null,
        `미확정 ${entry.sourceRow}행에 lexeme 자동 연결`,
      );
    }
  }

  const exactLinks = links.filter(
    (link) => link.mappingStatus === "exact_headword_unreviewed",
  );
  const unresolvedLinks = links.filter(
    (link) => link.mappingStatus === "unresolved",
  );
  const ambiguousLinks = links.filter(
    (link) => link.mappingStatus === "ambiguous",
  );
  assert(
    exactLinks.length === manifest.counts.exactLinkedRows,
    "정확연결 행 수 불일치",
  );
  assert(
    unresolvedLinks.length === manifest.counts.unresolvedRows,
    "미연결 행 수 불일치",
  );
  assert(
    ambiguousLinks.length === manifest.counts.ambiguousRows,
    "다중후보 행 수 불일치",
  );
  assert(
    new Set(exactLinks.map((link) => link.normalizedHeadword)).size ===
      manifest.counts.exactLinkedUniqueHeadwords,
    "정확연결 고유 표제어 수 불일치",
  );
  assert(
    new Set(unresolvedLinks.map((link) => link.normalizedHeadword)).size ===
      manifest.counts.unresolvedUniqueHeadwords,
    "미연결 고유 표제어 수 불일치",
  );

  const occurrences = await readJsonLines<OccurrenceRow>(
    path.join(options.packageDir, "occurrence_exact.jsonl"),
  );
  assert(
    occurrences.length === exactLinks.length,
    "교재 occurrence와 정확연결 행 수 불일치",
  );
  const occurrenceRows = new Set(
    occurrences.map((row) =>
      Number(row.item_label.replace("source_row:", "")),
    ),
  );
  assert(
    occurrenceRows.size === occurrences.length,
    "교재 occurrence sourceRow 중복",
  );
  for (const occurrence of occurrences) {
    assert(
      occurrence.sense_id === null,
      "교재 뜻을 canonical sense에 자동 연결함",
    );
    assert(
      occurrence.mapping_status === "exact_headword_unreviewed",
      "교재 occurrence 매핑상태 불일치",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "pass",
        verifiedFileCount: verifiedFiles.length,
        packageSnapshotSha256: manifest.packageSnapshotSha256,
        datasetRows: links.length,
        exactLinkedRows: exactLinks.length,
        unresolvedRows: unresolvedLinks.length,
        ambiguousRows: ambiguousLinks.length,
        canonicalSenseAutoLinks: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
