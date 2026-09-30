import { describe, expect, it } from "vitest";
import { wrongWordFilterKey, wrongWordFilterSearchParams, wrongWordFiltersFromSearchParams, wrongWordFiltersSchema } from "./wrong-word-filters";

const filters = { datasetId: "", level: "all" as const, query: "" };
describe("누적 오답 횟수 조건", () => {
  it("잘못된 입력 중에도 조건키 계산은 렌더 오류를 내지 않는다", () => {
    expect(() => wrongWordFilterKey({ ...filters, query: "x".repeat(201) })).not.toThrow();
    expect(wrongWordFiltersSchema.safeParse({ ...filters, query: "x".repeat(201) }).success).toBe(false);
  });
  it("기존 세 모드의 키와 빈 검색을 보존한다", () => {
    for (const level of ["all", "once", "repeated"] as const) {
      expect(wrongWordFilterKey({ ...filters, level, query: "  word  " })).toBe(JSON.stringify(["", level, "word"]));
    }
    expect(wrongWordFiltersSchema.parse({})).toEqual(filters);
  });
  it.each([{ minWrongCount: 1, maxWrongCount: 1 }, { minWrongCount: 3 }, { maxWrongCount: 5 }, { minWrongCount: 2, maxWrongCount: 4 }])("숫자 범위를 URL과 같은 조건으로 왕복한다: %j", range => {
    const input = { ...filters, ...range };
    expect(wrongWordFiltersFromSearchParams(wrongWordFilterSearchParams(input))).toMatchObject({ success: true, data: input });
    expect(wrongWordFilterKey(input)).not.toBe(wrongWordFilterKey(filters));
  });
  it.each(["", "0", "-1", "1.5", " 2", "2 ", "1e2", "0x10", "01", "NaN", "2147483648"])("잘못된 숫자 %j를 전체조회로 바꾸지 않는다", value => {
    expect(wrongWordFiltersFromSearchParams(new URLSearchParams({ minWrongCount: value })).success).toBe(false);
  });
  it("역전/중복 조건과 뜻밖의 학생ID를 거절한다", () => {
    for (const input of [{ minWrongCount: 4, maxWrongCount: 2 }, { level: "once", minWrongCount: 1 }, { level: "repeated", maxWrongCount: 5 }, { studentId: "someone" }]) {
      expect(wrongWordFiltersSchema.safeParse({ ...filters, ...input }).success).toBe(false);
    }
    expect(wrongWordFilterKey({ ...filters, minWrongCount: 2 })).not.toBe(wrongWordFilterKey({ ...filters, minWrongCount: 3 }));
  });
});

