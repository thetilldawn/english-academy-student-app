import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";

const datasetId = "11111111-1111-4111-8111-111111111111";
const modes = ["book_meaning_en_to_ko", "book_meaning_ko_to_en"] as const;
const failureMessage = "검토된 단어사전 출제 정보를 불러오지 못했습니다.";

function fixture(options: {
  count?: number;
  pageCap?: number;
  projection?: "empty" | "null";
  failAt?: number;
  failureStatus?: number;
  repeatPage?: boolean;
  reversePage?: boolean;
} = {}) {
  const count = options.count ?? 601;
  const entries = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    unit_id: "22222222-2222-4222-8222-222222222222",
    source_row: index + 1,
    headword: `sample${index + 1}`,
    headword_normalized: `sample${index + 1}`,
    primary_meaning: `가짜 뜻 ${index + 1}`,
  }));
  const eligibility = entries.flatMap(entry => modes.map(quiz_mode => ({
    vocab_entry_id: entry.id,
    quiz_mode,
    canonical_lexeme_id: null,
    canonical_dictionary_id: `word:sample${entry.id}`,
  })));
  const observed: Array<{ path: string; offset: number; order: string | null }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== "https://pagination-fixture.supabase.test") throw new Error("External request denied");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const requested = Number(url.searchParams.get("limit") ?? 1000);
    observed.push({ path: url.pathname, offset, order: url.searchParams.get("order") });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (url.pathname === "/rest/v1/vocab_entries") {
      expect(url.searchParams.get("dataset_id")).toBe(`eq.${datasetId}`);
      return json(entries.slice(offset, offset + Math.min(requested, 1000)));
    }
    if (url.pathname === "/rest/v1/vocab_entry_quiz_eligibility") {
      return json(eligibility.slice(offset, offset + Math.min(requested, 1000)));
    }
    if (url.pathname !== "/rest/v1/rpc/list_active_exam_use_eligibility_v1") {
      throw new Error("Unexpected API or write request");
    }
    expect(init?.method).toBe("POST"); // Existing stable read-only RPC.
    expect(JSON.parse(init?.body as string)).toEqual({ p_dataset_id: datasetId });
    if (options.failAt !== undefined && offset >= options.failAt) {
      return json({ message: "private database detail", code: "42501" }, options.failureStatus ?? 500);
    }
    if (options.projection === "empty") return json([]);
    if (options.projection === "null") return json(null);
    const start = options.repeatPage ? 0 : offset;
    const page = eligibility.slice(start, start + Math.min(requested, options.pageCap ?? 1000));
    return json(options.reversePage ? page.reverse() : page);
  });
  const client = createClient("https://pagination-fixture.supabase.test", "fake-publishable-key", {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    load: (projection = true) => loadEligibleVocabularyDataset(client, datasetId, { includeExamUseProjection: projection }),
    observed,
    rpc: () => observed.filter(row => row.path.includes("/rpc/")),
    fallback: () => observed.filter(row => row.path.endsWith("/vocab_entry_quiz_eligibility")),
  };
}

describe("출제 자격 조회부터 전체 단어 병합까지", () => {
  it("1202행의 마지막202행을 읽어601단어와1202방향을 복원한다", async () => {
    const source = fixture();
    const result = await source.load();
    expect(result).toHaveLength(601);
    expect(result.reduce((total, row) => total + (row.eligibleDirections?.length ?? 0), 0)).toBe(1202);
    expect(result.at(-1)).toMatchObject({ id: 601, canonicalDictionaryId: "word:sample601" });
    expect(source.rpc().map(row => row.offset)).toEqual([0, 1000, 1202]);
    expect(source.rpc().every(row => row.order === "vocab_entry_id.asc,quiz_mode.asc")).toBe(true);
    expect(source.fallback()).toHaveLength(0);
  });

  it("정확1000행 뒤에도 끝을 확인한다", async () => {
    const source = fixture({ count: 500 });
    expect(await source.load()).toHaveLength(500);
    expect(source.rpc().map(row => row.offset)).toEqual([0, 1000]);
  });

  it("더 작은 응답과 동일 단어의 두 방향이 갈리는 페이지도 누락하지 않는다", async () => {
    const source = fixture({ count: 8, pageCap: 3 });
    const result = await source.load();
    expect(result).toHaveLength(8);
    expect(result.every(row => row.eligibleDirections?.length === 2)).toBe(true);
    expect(source.rpc().map(row => row.offset)).toEqual([0, 3, 6, 9, 12, 15, 16]);
  });

  it("첫 정상0행에만 기존 자격표를 사용하며 기존 표의 페이지 읽기는 보존한다", async () => {
    const source = fixture({ projection: "empty" });
    expect(await source.load()).toHaveLength(601);
    expect(source.rpc()).toHaveLength(1);
    expect(source.fallback().map(row => row.offset)).toEqual([0, 1000]);
  });

  it("기존 자격표 전용 사용처는 RPC를 호출하지 않는다", async () => {
    const source = fixture();
    expect(await source.load(false)).toHaveLength(601);
    expect(source.rpc()).toHaveLength(0);
  });

  it.each([0, 1000])("%s행부터 실패하면 부분 성공이나 기존 자료로 대체하지 않는다", async failAt => {
    const source = fixture({ failAt });
    await expect(source.load()).rejects.toThrow(failureMessage);
    expect(source.fallback()).toHaveLength(0);
  });

  it.each([401, 403])("인증/권한%s도 기존 자격표로 우회하지 않는다", async failureStatus => {
    const source = fixture({ failAt: 0, failureStatus });
    await expect(source.load()).rejects.toThrow(failureMessage);
    expect(source.fallback()).toHaveLength(0);
  });

  it.each(["null", "repeat", "reverse"] as const)("%s 응답을 정상0이나 반복 성공으로 처리하지 않는다", async kind => {
    const source = fixture({
      count: 8, pageCap: 3,
      projection: kind === "null" ? "null" : undefined,
      repeatPage: kind === "repeat", reversePage: kind === "reverse",
    });
    await expect(source.load()).rejects.toThrow(failureMessage);
    expect(source.fallback()).toHaveLength(0);
    expect(source.rpc().length).toBeLessThanOrEqual(2);
  });
});
