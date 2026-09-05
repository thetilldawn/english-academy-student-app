export type StudyExampleInput = {
  dataset_key: string;
  package_sha256: string;
  question_item_id: string;
  question_item_sha256: string;
  source_entry_ids: string[];
  source_example_sha256: string;
  example_en: string;
};
export function buildStudyExamples(sourceRoot: string, sets: readonly {
  sourceVersion: string;
  exam: { datasetKey: string; setKey: string };
  question: { packagePath: string; packageFileSha256: string; exampleCount: number };
}[]): StudyExampleInput[];
export function buildStudyImportSql(rows: readonly StudyExampleInput[]): string;
