import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),requireAdmin:vi.fn(),getAdminContext:vi.fn()}));
vi.mock("@/lib/auth/admin",()=>({requireAdmin:mocks.requireAdmin,getAdminContext:mocks.getAdminContext}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc})}));
import { createComposition } from "./commands/create-composition";
import { getCompositionCatalog } from "./queries/composition-catalog";
import { GET,POST } from "@/app/api/admin/wordbook-compositions/route";
const request={requestId:'00000000-0000-4000-8000-000000000001',title:'가짜 단어장',scopes:[{id:'00000000-0000-4000-8000-000000000002',version:'a'.repeat(64)}]};
const created={datasetId:'00000000-0000-4000-8000-000000000003',title:request.title,scopeCount:1,sourceEntryCount:5,includedEntryCount:4};
beforeEach(()=>{vi.resetAllMocks();mocks.requireAdmin.mockResolvedValue({userId:'admin'});mocks.getAdminContext.mockResolvedValue({userId:'admin'});});
describe('composition server boundary',()=>{
  it('authenticates before reading and rejects invalid catalog payloads',async()=>{
    mocks.rpc.mockResolvedValue({data:{scopes:[]},error:null});expect(await getCompositionCatalog()).toEqual({scopes:[]});expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    mocks.rpc.mockResolvedValue({data:{scopes:[],secret:'raw'},error:null});await expect(getCompositionCatalog()).rejects.toThrow('composition_catalog_unavailable');
  });
  it('keeps the exact request id and version while validating both input and output',async()=>{
    mocks.rpc.mockResolvedValue({data:created,error:null});expect(await createComposition(request)).toEqual(created);
    expect(mocks.rpc).toHaveBeenCalledWith('create_mock_wordbook_composition_v1',{p_request:request});
    await expect(createComposition({...request,words:['unreviewed']})).rejects.toMatchObject({status:422});
    mocks.rpc.mockResolvedValue({data:{...created,title:'wrong'},error:null});await expect(createComposition(request)).rejects.toMatchObject({status:503});
  });
  it.each([['42501',403],['40001',409],['22023',422],['XX000',503]])('maps %s to safe status %s',async(code,status)=>{
    mocks.rpc.mockResolvedValue({error:{code,message:'private SQL content'},data:null});
    const response=await POST(new Request('http://localhost/api/admin/wordbook-compositions',{method:'POST',body:JSON.stringify(request)}));
    expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.text()).not.toContain('private SQL');
  });
  it('returns no source data or side effects to unauthenticated requests',async()=>{
    mocks.getAdminContext.mockResolvedValue(null);
    for (const response of [await GET(),await POST(new Request('http://localhost/api/admin/wordbook-compositions',{method:'POST',body:JSON.stringify(request)}))]) {
      expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
