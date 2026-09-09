import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { loadSelectedVocabularyRowCount } from "./bulk-assignment-planning-query";

beforeEach(() => vi.resetAllMocks());
it.each([0, 111, 320, 601])("선택한 단어장/단위의 원본 수%i만 읽고 실제 행은 가져오지 않는다", async count => {
  const inUnits = vi.fn(async () => ({ count, error: null }));
  const eq = vi.fn(() => ({ in: inUnits }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.client.mockResolvedValue({ from });
  expect(await loadSelectedVocabularyRowCount("fake-book", ["fake-unit"])).toBe(count);
  expect(from).toHaveBeenCalledExactlyOnceWith("vocab_entries");
  expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true });
  expect(eq).toHaveBeenCalledWith("dataset_id", "fake-book");
  expect(inUnits).toHaveBeenCalledWith("unit_id", ["fake-unit"]);
});
it.each([{ count: 0, error: { code: "42501" } }, { count: null, error: null }, { count: -1, error: null }])(
  "실패·미제공 수량을 정상0개로 바꾸지 않는다", async response => {
    mocks.client.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ in: async () => response }) }) }) });
    expect(await loadSelectedVocabularyRowCount("fake-book", ["fake-unit"])).toBeNull();
  },
);
it("미선택에서 조회하지 않고 연결 예외를 미확인으로 반환한다", async () => {
  expect(await loadSelectedVocabularyRowCount("fake-book", [])).toBeNull();
  expect(mocks.client).not.toHaveBeenCalled();
  mocks.client.mockRejectedValue(new Error("PRIVATE_SERVER_DETAIL"));
  expect(await loadSelectedVocabularyRowCount("fake-book", ["fake-unit"])).toBeNull();
});
