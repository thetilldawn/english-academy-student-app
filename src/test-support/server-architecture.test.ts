import { describe, expect, it } from "vitest";
import { collectDirectDbWriteCalls } from "./server-architecture";

describe("조회의 DB 쓰기와 로컬 메모리 제거 구분", () => {
  it("const native Map/Set 제거만 제외한다", () => {
    const calls = collectDirectDbWriteCalls("fixture.ts", "const entries = new Map(); const listeners = new Set(); entries.delete(key); listeners.delete(listener); db.from('students').delete();");
    expect(calls.map(call => call.method)).toEqual(["delete"]);
  });
  it.each([
    "const entries = new Map(); function run(entries: any) { entries.delete(); }",
    "const Map = DatabaseClient; const entries = new Map(); entries.delete();",
    "import { Map } from 'db'; const entries = new Map(); entries.delete();",
    "let entries = new Map(); entries = db; entries.delete();",
    "const entries = new CustomMap(); entries.delete();",
    "const entries = new Map(); const alias = db; alias.delete();",
    "const entries = new Map(); db.update({});",
  ])("DB/unknown/shadowed receiver는 계속 탐지한다: %s", source => {
    expect(collectDirectDbWriteCalls("fixture.ts", source)).toHaveLength(1);
  });
});
