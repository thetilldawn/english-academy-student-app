import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const sourceHashes = {
  "v2_최신범위": "986f93217bf4b1ca7f37aa07abe7e01a717d3dc7fd15d3ed047c3598bdff0723",
  "v3_고1_1_2과_정정": "9c597b13423a77005552906a3f389eb9ee5639f76f99c275519009c9a3967ad8",
};

// Purely rebuild a learning sidecar from already-approved sources, never generate sentences.
export function buildStudyExamples(sourceRoot, sets) {
  const wordsByVersion = new Map();
  const result = [];
  for (const set of sets) {
    if (!wordsByVersion.has(set.sourceVersion)) {
      const source = fs.readFileSync(path.join(sourceRoot, set.sourceVersion, "01_원본복구묶음/exam-entries.jsonl"), "utf8");
      if (sha(source) !== sourceHashes[set.sourceVersion]) throw new Error("study_source_file_hash_mismatch");
      const entries = source.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
      wordsByVersion.set(set.sourceVersion, new Map(entries.map((entry) => [entry.entry_id, entry])));
    }
    const source = fs.readFileSync(path.join(sourceRoot, set.sourceVersion, "03_통합문항_앱전달묶음", set.question.packagePath), "utf8");
    if (sha(source) !== set.question.packageFileSha256) throw new Error("study_question_package_hash_mismatch");
    const items = JSON.parse(source).items.filter((item) => item.quiz_mode === "canonical_example_to_headword");
    if (items.length !== set.question.exampleCount) throw new Error("study_example_count_mismatch");
    for (const item of items) {
      const entry = wordsByVersion.get(set.sourceVersion).get(item.provenance.target_entry_id);
      if (!entry || entry.set_key !== set.exam.setKey || typeof entry.example_en !== "string" || !entry.example_en.trim() || /_{2,}/u.test(entry.example_en)) {
        throw new Error("study_original_example_missing");
      }
      if (sha(entry.example_en) !== item.source_example_content_hash) throw new Error("study_original_example_hash_mismatch");
      result.push({
        dataset_key: set.exam.datasetKey,
        package_sha256: set.question.packageFileSha256,
        question_item_id: item.question_item_id,
        question_item_sha256: item.content_hash,
        source_entry_ids: item.source_entry_ids,
        source_example_sha256: item.source_example_content_hash,
        example_en: entry.example_en,
      });
    }
  }
  return result;
}

// Used only by the operator after local tests. The statement is all-or-nothing and idempotent.
export function buildStudyImportSql(rows) {
  const json = JSON.stringify(rows).replaceAll("'", "''");
  const expected = rows.reduce((sum, row) => sum + row.source_entry_ids.length, 0);
  return `begin;
create temporary table study_input on commit drop as
select * from jsonb_to_recordset('${json}'::jsonb) as i(
 dataset_key text, package_sha256 text, question_item_id text, question_item_sha256 text,
 source_entry_ids text[], source_example_sha256 text, example_en text);
create temporary table study_matched on commit drop as
select q.release_id, q.vocab_entry_id, i.question_item_id, i.question_item_sha256,
 i.source_example_sha256, i.example_en
from study_input i join public.vocab_datasets d on d.dataset_key=i.dataset_key
join word_index.app_canonical_question_preview_release r
 on r.dataset_id=d.id and r.package_file_sha256=i.package_sha256
join word_index.app_canonical_question_preview_item q
 on q.release_id=r.release_id and q.question_item_id=i.question_item_id
 and q.question_item_sha256=i.question_item_sha256
 and q.source_entry_id=any(i.source_entry_ids) and q.quiz_mode='canonical_example_to_headword'
 and q.source_example_content_hash=i.source_example_sha256;
do $$ begin
 if (select count(*) from study_matched) <> ${expected} then raise exception 'study_source_binding_mismatch'; end if;
 if exists(select 1 from study_matched where source_example_sha256 <> encode(extensions.digest(convert_to(example_en,'UTF8'),'sha256'),'hex') or example_en ~ '_{2,}') then raise exception 'study_example_invalid'; end if;
end $$;
insert into private.assignment_study_examples_v1(release_id,vocab_entry_id,question_item_id,question_item_sha256,source_example_sha256,example_en)
select release_id,vocab_entry_id,question_item_id,question_item_sha256,source_example_sha256,example_en from study_matched
on conflict(release_id,vocab_entry_id) do nothing;
do $$ begin
 if (select count(*) from study_matched m join private.assignment_study_examples_v1 s using(release_id,vocab_entry_id)
 where s.question_item_id=m.question_item_id and s.question_item_sha256=m.question_item_sha256
 and s.source_example_sha256=m.source_example_sha256 and s.example_en=m.example_en) <> ${expected}
 then raise exception 'study_existing_source_mismatch'; end if;
end $$;
commit;
select ${expected}::int as verified_examples;`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceRoot, manifest] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(buildStudyExamples(sourceRoot, JSON.parse(fs.readFileSync(manifest, "utf8")))));
}
