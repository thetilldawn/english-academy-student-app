import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({requireAdmin:mocks.admin}));
vi.mock('@/lib/supabase/server',()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc})}));
import {queueStudentMistakes} from './queue-mistakes';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target={sourceQuestionId:id(2),sourcePhase:'retry' as const,meaningKey:'a'.repeat(64),episodeId:id(3),stateVersion:'9007199254740993'};
beforeEach(()=>{vi.resetAllMocks();mocks.admin.mockResolvedValue({});mocks.rpc.mockResolvedValue({data:[id(4)],error:null});});
describe('뜻별 복습 대기 저장',()=>{
  it('관리자 인증 뒤 선택한 문항·단계·뜻·구간·상태판을 손실 없이 전달한다',async()=>{
    expect(await queueStudentMistakes(id(1),[target])).toEqual([id(4)]);
    expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('queue_student_vocabulary_mistakes_v1',{p_student_id:id(1),p_targets:[target]});
  });
  it('동일 뜻 중복 선택과 잘못된 참조는 저장 전에 거절한다',async()=>{
    await expect(queueStudentMistakes(id(1),[target,{...target,sourceQuestionId:id(5)}])).rejects.toMatchObject({status:400});
    await expect(queueStudentMistakes('invalid',[target])).rejects.toMatchObject({status:400});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['40001',409],['PT409',409],['22023',409],['42501',403],['57014',503]])('DB %s를 HTTP %s로 구별한다',async(code,status)=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code}});
    await expect(queueStudentMistakes(id(1),[target])).rejects.toMatchObject({status});
  });
  it.each([null,[],['not-an-id'],[id(4),id(4)]])('누락되거나 잘못된 저장 결과를 성공으로 알리지 않는다: %s',async data=>{
    mocks.rpc.mockResolvedValueOnce({data,error:null});
    await expect(queueStudentMistakes(id(1),[target])).rejects.toMatchObject({status:503});
  });
});
