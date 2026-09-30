import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),preview:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getAdminContext:mocks.admin}));
vi.mock('./use-cases/notebook-assignment',()=>({previewNotebookAssignment:mocks.preview,saveNotebookAssignment:mocks.save}));
import {notebookAssignmentHandler} from './notebook-assignment-http';
import {NotebookAssignmentError} from './persistence/notebook-assignment';
import {AuthenticationUnavailableError} from '@/lib/auth/authentication-error';
const id='00000000-0000-4000-8000-000000000001',input={requestKey:id,studentIds:[id],audienceMode:'bulk',filters:{},settings:{questionCount:1,englishToKoreanRatio:100,timingMode:'none',timeLimitSeconds:null,questionTimeLimitSeconds:null,passingScore:80,retryEnabled:false,retryPassingScore:null}};
const request=(body:unknown,origin='https://app.test')=>new Request('https://app.test/api/admin/notebook-assignments',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_ORIGIN','https://app.test');mocks.admin.mockResolvedValue({userId:id});});
afterEach(()=>vi.unstubAllEnvs());
describe('교사 오답 배정 HTTP',()=>{
 it('다른 출처는 인증/조회도 하지 않는다',async()=>{const response=await notebookAssignmentHandler('preview')(request(input,'https://other.test'));expect(response.status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled();});
 it('비로그인과 인증 일시장애를 구분하고 모두 캐시하지 않는다',async()=>{
  mocks.admin.mockResolvedValueOnce(null).mockRejectedValueOnce(new AuthenticationUnavailableError());
  for(const status of [401,503]){const response=await notebookAssignmentHandler('preview')(request(input));expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toContain('no-store');}
  expect(mocks.preview).not.toHaveBeenCalled();
 });
 it('클라이언트 관리자ID·문항·추가 포인트 정책은 받지 않는다',async()=>{
  for(const extra of [{adminId:id},{questions:[]},{pointsPolicyVersion:'vocab-points-v1'}])expect((await notebookAssignmentHandler('preview')(request({...input,...extra}))).status).toBe(400);
  expect(mocks.preview).not.toHaveBeenCalled();
 });
 it('미리보기와 저장은 인증된 관리자 및 검증한 요청만 전달한다',async()=>{
  mocks.preview.mockResolvedValue({confirmation:'a'.repeat(64),students:[]});mocks.save.mockResolvedValue([]);
  const preview=await notebookAssignmentHandler('preview')(request(input));expect(preview.status).toBe(200);expect(mocks.preview.mock.calls[0][0]).toBe(id);
  const save=await notebookAssignmentHandler('save')(request({...input,confirmation:'a'.repeat(64),gradeConfirmedStudentIds:[]}));expect(save.status).toBe(201);expect(save.headers.get('cache-control')).toBe('private, no-store');
 });
 it('원천 변경과 알 수 없는 저장 실패를 분리하고 내부 오류를 숨긴다',async()=>{
  mocks.preview.mockRejectedValueOnce(new NotebookAssignmentError(409,'다시 확인해 주세요.','source_changed')).mockRejectedValueOnce(new Error('secret sql token'));
  const changed=await notebookAssignmentHandler('preview')(request(input));expect(changed.status).toBe(409);expect(await changed.json()).toMatchObject({code:'source_changed'});
  const failed=await notebookAssignmentHandler('preview')(request(input));expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('secret');
 });
});
