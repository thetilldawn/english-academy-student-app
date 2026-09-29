import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ read:vi.fn() }));
vi.mock("@/lib/env",()=>({getStudentSessionEnvironment:()=>({STUDENT_SESSION_PEPPER:"fake-pepper"})}));
vi.mock("@/lib/auth/student-code",()=>({getStudentCookieName:()=>"fake",hashStudentSessionToken:()=>"fake-hash"}));
vi.mock("@/lib/supabase/service",()=>({getServiceSupabaseClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.read})})})})}));
import { validateStudentSessionToken } from "./student-session-query";
const row=()=>({id:"fake-session",student_id:"fake-student",code_generation:1,expires_at:new Date(Date.now()+60*86400000).toISOString(),last_seen_at:new Date().toISOString(),revoked_at:null,students:{id:"fake-student",display_name:"가짜 학생",school_name:null,grade_label:null,status:"active",code_generation:1,deleted_at:null}});
beforeEach(()=>vi.clearAllMocks());
it.each([{code:"57014"},new Error("network")])("학생 인증 조회 오류는 무효세션으로 바꾸지 않는다: %s",async(error)=>{
  mocks.read.mockResolvedValue({data:null,error});
  await expect(validateStudentSessionToken("fake-token")).rejects.toMatchObject({name:"AuthenticationUnavailableError"});
});
it("전송 실패도 인증장애로 구분한다",async()=>{
  mocks.read.mockRejectedValue(new Error("network"));
  await expect(validateStudentSessionToken("fake-token")).rejects.toMatchObject({name:"AuthenticationUnavailableError"});
});
it("정상 세션과 실제없는 세션을 구분한다",async()=>{
  mocks.read.mockResolvedValueOnce({data:row(),error:null}).mockResolvedValueOnce({data:null,error:null});
  expect((await validateStudentSessionToken("fake-token"))?.studentId).toBe("fake-student");
  expect(await validateStudentSessionToken("fake-token")).toBeNull();
});
it.each(["expired","blocked","rotated","revoked","deleted"])("실제 %s는 여전히 차단한다",async(kind)=>{
  const data=row();
  if(kind==="expired") data.expires_at=new Date(Date.now()-1).toISOString();
  if(kind==="blocked") data.students.status="blocked";
  if(kind==="rotated") data.code_generation=2;
  const changed={...data,...(kind==="revoked"?{revoked_at:new Date().toISOString()}:{}),students:{...data.students,...(kind==="deleted"?{deleted_at:new Date().toISOString()}:{})}};
  mocks.read.mockResolvedValue({data:changed,error:null});
  expect(await validateStudentSessionToken("fake-token")).toBeNull();
});
