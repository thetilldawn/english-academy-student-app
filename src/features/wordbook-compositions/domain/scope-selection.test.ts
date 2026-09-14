import { describe, expect, it } from "vitest";
import { matchesScope, changeVisibleSelection, summarizeScopeSelection, EMPTY_SCOPE_FILTERS } from "./scope-selection";
import { scopeMetadataSchema, createCompositionSchema, type SourceScope } from "../contracts/composition";

const metadata = { executionYear: 2026, examMonth: 3, examKind: "mock" as const, academicYear: null, agency: "가짜", typeCode: "blank", typeLabel: "빈칸", questionNumbers: [31], sharedPassage: false };
describe("mock scope selection", () => {
  it("combines values within one filter and intersects independent filters", () => {
    expect(matchesScope(metadata, EMPTY_SCOPE_FILTERS)).toBe(true);
    expect(matchesScope(metadata, {years:[2024,2026],months:[3,6],types:["blank","long_reading"]})).toBe(true);
    expect(matchesScope(metadata, {years:[2025],months:[],types:[]})).toBe(false);
    expect(matchesScope(metadata, {years:[2026],months:[6],types:[]})).toBe(false);
    expect(matchesScope(metadata, {years:[],months:[],types:["long_reading"]})).toBe(false);
  });
  it("keeps hidden choices and repeated additions do not copy scopes", () => {
    const selected = changeVisibleSelection(["2024-3"], ["2025-6","2026-3"], true);
    expect(changeVisibleSelection(selected,["2025-6"],false)).toEqual(["2024-3","2026-3"]);
    expect(changeVisibleSelection(selected,["2025-6"],true)).toEqual(selected);
    expect(changeVisibleSelection(selected,[],false)).toEqual(selected);
  });
  it("counts occurrences independently from target deduplication",()=>{
    const scopes = [1,2].map(i => ({id:String(i),version:'a'.repeat(64),displayName:`가짜${i}`,sourceTitle:'가짜',sourceEntryCount:5,includedEntryCount:4,metadata})) satisfies SourceScope[];
    expect(summarizeScopeSelection(scopes,['1','1','2'])).toMatchObject({scopeCount:2,sourceEntryCount:10,includedEntryCount:8});
  });
  it("accepts separate long passage groups and rejects split or repeated questions",()=>{
    for (const questionNumbers of [[41,42],[43,44,45]]) expect(scopeMetadataSchema.safeParse({...metadata,questionNumbers,sharedPassage:true}).success).toBe(true);
    for (const questionNumbers of [[41],[41,41],[41,42,43],[42,41]]) expect(scopeMetadataSchema.safeParse({...metadata,questionNumbers,sharedPassage:true}).success).toBe(false);
  });
  it("rejects unbounded or repeated source IDs and extra user-supplied word content",()=>{
    const scope={id:'00000000-0000-4000-8000-000000000001',version:'a'.repeat(64)};
    const request={requestId:'00000000-0000-4000-8000-000000000002',title:'  고3 단어장  ',scopes:[scope]};
    expect(createCompositionSchema.parse(request).title).toBe('고3 단어장');
    expect(createCompositionSchema.safeParse({...request,scopes:[scope,scope]}).success).toBe(false);
    expect(createCompositionSchema.safeParse({...request,entries:[{headword:'fake'}]}).success).toBe(false);
  });
});
