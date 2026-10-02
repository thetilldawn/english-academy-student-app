import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),preview:vi.fn(),Error:class extends Error {constructor(public status:number,message:string,public code?:string){super(message);}}}));
vi.mock('@/lib/auth/admin',()=>({getAdminContext:mocks.admin}));
vi.mock('@/features/assignments/public-server',()=>({previewMixedMistakeAssignment:mocks.preview,NotebookAssignmentError:mocks.Error}));
import { POST } from './route';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={planVersion:'meaning-episode-v1',studentId:id(1),datasetId:id(2),primaryUnitIds:[id(3)],reviewLevels:[1,2],totalQuestionCount:20,title:'',englishToKoreanRatio:50,timeLimitSeconds:300,passingScore:80,retryEnabled:true,retryPassingScore:80,questionOrderMode:'ascending',availableUntil:null};
const request=(body:unknown=input,origin='http://localhost')=>new Request('http://localhost/api/admin/mixed-assignments/preview',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({userId:id(4)});});
describe('뜻별 혼합 미리보기 경계',()=>{
  it('원 요청 범위로 관리자 미리보기를 조회하며 개인 캐시 저장을 금지한다',async()=>{
    mocks.preview.mockResolvedValueOnce({planVersion:'meaning-episode-v1',selectionFingerprint:null,error:'범위를 확인해 주세요.'});
    const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(mocks.preview).toHaveBeenCalledWith(id(4),expect.objectContaining(input));
  });
  it('다른 origin·미로그인·구버전·추가 필드를 차단한다',async()=>{
    expect((await POST(request(input,'https://attacker.invalid'))).status).toBe(403);
    mocks.admin.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(401);
    for(const bad of [{...input,planVersion:'unknown'},{...input,confirmation:'forged'},{...input,primaryUnitIds:[id(3),id(3)]}])expect((await POST(request(bad))).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([409,422,503])('%i 오류의 내부 정보는 공개하지 않는다',async status=>{
    mocks.preview.mockRejectedValueOnce(status===503?new Error('private secret'):new mocks.Error(status,'범위를 다시 확인해 주세요.','source_changed'));
    const response=await POST(request());expect(response.status).toBe(status);expect(await response.text()).not.toContain('private secret');
  });
});
