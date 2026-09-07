import {describe,it,expect,vi,beforeEach} from "vitest";
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:vi.fn()}));
import {createServerSupabaseClient} from "@/lib/supabase/server";
import {reviewedReplacementMode} from "./reviewed-assignment-replacement-planning";
describe("replacement destination routing",()=>{
  const single=vi.fn();
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(createServerSupabaseClient).mockResolvedValue({from:()=>({select:()=>({eq:()=>({maybeSingle:single})})})} as never);});
  it("reuses known same-dataset ownership without querying again",async()=>{
    expect(await reviewedReplacementMode("same","same","canonical_headword_to_definition")).toBe("canonical_headword_to_definition");
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });
  it("allows reviewed meaning tests to switch to an ordinary wordbook",async()=>{
    single.mockResolvedValue({data:{metadata:{}},error:null});
    expect(await reviewedReplacementMode("other","prior","book_meaning_choice")).toBeNull();
    await expect(reviewedReplacementMode("other","prior","canonical_definition_to_headword")).rejects.toThrow("검토된 문제가 없습니다");
  });
  it("uses reviewed plans when changing from ordinary to a reviewed wordbook",async()=>{
    single.mockResolvedValue({data:{metadata:{questionBankKind:"reviewed_exam_v1"}},error:null});
    expect(await reviewedReplacementMode("other","prior")).toBe("book_meaning_choice");
  });
});
