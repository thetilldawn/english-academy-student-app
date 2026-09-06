import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { nucleusFixture, schoolPronunciationFixture } from "@/test-support/pronunciation-fixtures";
import { SCHOOL_PRONUNCIATION_SCOPES, validateSchoolPronunciationRelease } from "@/lib/vocab/school-pronunciation-release-contract";
import { parseVocabPronunciationIdentityV2 } from "@/lib/quiz/pronunciation-snapshot";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";

async function seedRelease(db: PGlite, release: {dataset_key:string; dataset_source_sha256:string; summary:{expected_entry_count:number}; bindings:readonly unknown[]}) {
  const result = await db.query<{id:string}>(`insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count)
    values($1,'Fake pronunciation test','fake',$2,$3) returning id`,
  [release.dataset_key, release.dataset_source_sha256, release.summary.expected_entry_count]);
  const unit = await db.query<{id:string}>(`insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
    values($1,'DAY 01','day 01','day',1,1,$2) returning id`, [result.rows[0].id, release.bindings.length]);
  await db.query(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
    select $1, r.source_row, r.entry_row_sha256, r.headword, r.headword_normalized, array['가짜'], '가짜', $3, r.source_row, 'word'
    from jsonb_to_recordset($2::jsonb) r(source_row integer,entry_row_sha256 text,headword text,headword_normalized text)`,
  [result.rows[0].id, JSON.stringify(release.bindings), unit.rows[0].id]);
}

describe.sequential("approved school pronunciation final schema", () => {
  let db: PGlite;
  const fixtures = [nucleusFixture(), ...SCHOOL_PRONUNCIATION_SCOPES.map((_, i) => schoolPronunciationFixture(i))];
  const rpc = (name: string, ...args: unknown[]) =>
    db.query(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`, args.map((v) => typeof v === "string" ? v : JSON.stringify(v)));
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    for (const release of fixtures) {
      await seedRelease(db, release);
    }
  }, 60_000);
  afterAll(async () => { await db?.close(); });

  it("limits public/private writes to the intended server boundary", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await expect(rpc("stage_school_pronunciation_release_v1", {})).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await expect(db.query("select private.stage_school_pronunciation_release_v1('{}')")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.vocab_pronunciation_releases_v2")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("rejects an unapproved key/hash/count and use of the school stage for VOCA", async () => {
    const header = vocabPronunciationReleaseHeader(fixtures[1] as never);
    for (const changed of [{dataset_key:"simseok-unapproved"}, {dataset_source_sha256:"F".repeat(64)}, {expected_entry_count:112}]) {
      await expect(rpc("stage_school_pronunciation_release_v1", {...header,...changed})).rejects.toThrow();
    }
    await expect(rpc("stage_school_pronunciation_release_v1", vocabPronunciationReleaseHeader(fixtures[0] as never))).rejects.toThrow();
    await expect(rpc("stage_vocab_pronunciation_release_v3", header)).rejects.toThrow();
  });

  it("stages, verifies, activates every approved dataset without replacing other releases", async () => {
    for (const [index, release] of fixtures.entries()) {
      const header = vocabPronunciationReleaseHeader(release as never);
      const stage = index === 0 ? "stage_vocab_pronunciation_release_v3" : "stage_school_pronunciation_release_v1";
      await db.exec("set role service_role");
      await rpc(stage, header);
      await expect(rpc("activate_vocab_pronunciation_release_v3", release.release_id)).rejects.toThrow();
      await rpc("import_vocab_pronunciation_identity_batch_v3", release.release_id, release.identities);
      await rpc("import_vocab_pronunciation_identity_batch_v3", release.release_id, release.identities);
      await expect(rpc("import_vocab_pronunciation_binding_batch_v3", release.release_id,
        [{...release.bindings[0], lexical_pos:"verb"}])).rejects.toThrow();
      for (let offset = 0; offset < release.bindings.length; offset += 400) {
        await rpc("import_vocab_pronunciation_binding_batch_v3", release.release_id, release.bindings.slice(offset, offset + 400));
      }
      await rpc("import_vocab_pronunciation_binding_batch_v3", release.release_id, [release.bindings[0]]);
      await rpc("verify_vocab_pronunciation_release_v3", release.release_id);
      await rpc("activate_vocab_pronunciation_release_v3", release.release_id);
      await rpc(stage, header);
      await db.exec("reset role");
      const active = await db.query<{n:number}>("select count(*)::int n from public.vocab_pronunciation_releases_v2 where status='active'");
      expect(active.rows[0].n).toBe(index + 1);
    }
    const identities = await db.query<{n:number}>("select count(*)::int n from public.vocab_pronunciation_identities_v2");
    expect(identities.rows[0].n).toBe(1);
  }, 30_000);

  it("accepts only exact old or normal-rate generic asset paths", async () => {
    const hash = "a".repeat(64);
    for (const profile of ["profile:1a77d56d47e26013", "profile:286866721f7f4ee8"]) {
      const asset = {request_sha256:hash, audio_sha256:"b".repeat(64),byte_count:128,
        storage_bucket:"vocab-pronunciation-audio",storage_object_key:`pronunciation/google_cloud_text_to_speech/${profile.replace(":", "-")}/${hash}.mp3`,
        profile_id:profile,model:"chirp3-hd",voice:"en-US-Chirp3-HD-Despina",storage_verified:true};
      await db.exec("begin");
      await rpc("register_vocab_pronunciation_tts_asset_batch_v2", [asset]);
      await db.exec("rollback");
      for (const changed of [{storage_object_key:"wrong.mp3"},{profile_id:"profile:5b6efb0ecc8f4702"},{storage_verified:false},{storage_bucket:"other"}]) {
        await expect(rpc("register_vocab_pronunciation_tts_asset_batch_v2", [{...asset,...changed}])).rejects.toThrow();
      }
    }
  });

  it.skipIf(!process.env.SCHOOL_PRONUNCIATION_RELEASE_DIRECTORY)("imports all current local releases against the complete schema and existing identity bytes", async () => {
    const directory = process.env.SCHOOL_PRONUNCIATION_RELEASE_DIRECTORY!;
    const local = await createFinalSchemaDatabase();
    const call = (name: string, ...args: unknown[]) => local.query(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")})`, args.map(v=>typeof v === "string"?v:JSON.stringify(v)));
    const read = (file:string) => JSON.parse(fs.readFileSync(path.join(directory,file),"utf8"));
    try {
      const releases = SCHOOL_PRONUNCIATION_SCOPES.map(scope => validateSchoolPronunciationRelease(read(scope.datasetKey + ".release.json")).release);
      const assets = new Map<string, Record<string,unknown>>();
      for (const release of releases) {
        await seedRelease(local,release);
        const manifest = read(release.dataset_key + ".manifest.json");
        for (const item of manifest.items) {
          const bytes=fs.readFileSync(path.join(directory,"objects",item.file_name));
          expect(bytes.length).toBe(item.byte_count);
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.audio_sha256);
          assets.set(item.request_sha256, Object.fromEntries(["request_sha256","audio_sha256","byte_count","storage_bucket","storage_object_key","profile_id","model","voice"].map(k=>[k,item[k]]).concat([["storage_verified",true]])));
        }
      }
      const priorAssets = JSON.parse(fs.readFileSync(path.join(directory,"../registered-tts-assets.json"),"utf8")).assets;
      const priorIdentities = JSON.parse(fs.readFileSync(path.join(directory,"../production-release-snapshot.json"),"utf8")).identities;
      const allAssets = new Map([...priorAssets.map((a:Record<string,unknown>)=>[a.request_sha256,a]),...assets]);
      const values = [...allAssets.values()];
      for(let i=0;i<values.length;i+=100) await call("register_vocab_pronunciation_tts_asset_batch_v2",values.slice(i,i+100));
      const first = releases[0];
      await call("stage_school_pronunciation_release_v1",vocabPronunciationReleaseHeader(first));
      for(let i=0;i<priorIdentities.length;i+=100) await call("import_vocab_pronunciation_identity_batch_v3",first.release_id,priorIdentities.slice(i,i+100));
      for (const release of releases) {
        await call("stage_school_pronunciation_release_v1",vocabPronunciationReleaseHeader(release));
        for(let i=0;i<release.identities.length;i+=100) await call("import_vocab_pronunciation_identity_batch_v3",release.release_id,release.identities.slice(i,i+100));
        for(let i=0;i<release.bindings.length;i+=200) await call("import_vocab_pronunciation_binding_batch_v3",release.release_id,release.bindings.slice(i,i+200));
        await call("verify_vocab_pronunciation_release_v3",release.release_id);
        await call("activate_vocab_pronunciation_release_v3",release.release_id);
        for(const identity of release.identities) expect(parseVocabPronunciationIdentityV2(identity,"https://xdxhswjgksukjmpbzqgz.supabase.co")?.available).toBe(true);
      }
      const oldRows = await local.query<{identity_id:string;payload:unknown}>("select identity_id,to_jsonb(i)-'imported_at' payload from public.vocab_pronunciation_identities_v2 i where identity_id=any($1)",[priorIdentities.map((i:{identity_id:string})=>i.identity_id)]);
      const oldById = new Map(oldRows.rows.map(i=>[i.identity_id,i.payload]));
      for(const identity of priorIdentities) expect(oldById.get(identity.identity_id)).toEqual(identity);
      expect((await local.query<{n:number}>("select count(*)::int n from public.vocab_entry_pronunciation_bindings_v2")).rows[0].n).toBe(1509);
    } finally { await local.close(); }
  }, 60_000);
});
