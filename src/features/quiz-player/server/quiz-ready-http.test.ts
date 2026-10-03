import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({session:vi.fn(),begin:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:m.session}));
vi.mock("@/features/quiz-player/public-server",async()=>{
  const {QuizPreparationChangedError}=await import('./attempt-preparation');
  return {beginQuizPreparation:m.begin,QuizPreparationChangedError};
});
import {POST} from '@/app/api/student/attempts/[id]/ready/route';
import {QuizPreparationChangedError} from './attempt-preparation';
const id='a5050000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('APP_ORIGIN','https://app.test');m.session.mockResolvedValue({studentId:id});});
afterEach(()=>vi.unstubAllEnvs());
it.each([['preparation_changed',409],['quiz_new_attempts_paused',503]] as const)('구형 시작의 %s 오류를 구별하며 개인 응답은 저장하지 않는다',async(code,status)=>{
  m.begin.mockRejectedValue(new QuizPreparationChangedError('안전한 안내',code));
  const response=await POST(new Request(`https://app.test/api/student/attempts/${id}/ready`,{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/json'},body:JSON.stringify({kind:'initial'})}),{params:Promise.resolve({id})});
  expect(response.status).toBe(status);expect(await response.json()).toEqual({code,error:'안전한 안내'});
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
