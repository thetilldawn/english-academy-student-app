import { beforeEach, expect, it, vi } from "vitest";
import { fakeSchoolBundle as bundle } from "../../school-schedule.fixture";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), student: vi.fn(), rpc: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/auth/student-session", () => ({ requireStudentSession: mocks.student }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.service }) }));
import { getAdminSchoolScheduleMap, getAdminSchoolScheduleOverview, getCurrentStudentSchoolSchedule } from "./school-schedule-query";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const profile = {id,schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"};
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({id:"admin"}); mocks.student.mockResolvedValue({studentId:id}); });
it("현재 페이지를 한 번에 읽고 다른 학생이 섞이면 실패로 표시한다", async () => {
  mocks.rpc.mockResolvedValue({data:{students:[profile],bundles:[bundle]},error:null});
  const map=await getAdminSchoolScheduleMap([id]); expect(map[id].status).toBe("ready");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_admin_school_schedules_v1",{p_student_ids:[id]});
  mocks.rpc.mockResolvedValue({data:{students:[{...profile,id:other}],bundles:[bundle]},error:null});
  expect((await getAdminSchoolScheduleMap([id]))[id].status).toBe("error");
});
it("실패·누락·잘못된 계약은 정상 0건과 다르다", async () => {
  for (const result of [{data:null,error:{message:"SQL SECRET"}}, {data:{students:[],bundles:[{...bundle,events:[{}]}]},error:null}, {data:{},error:null}]) {
    mocks.rpc.mockResolvedValue(result);
    expect(await getAdminSchoolScheduleOverview()).toMatchObject({status:"error",groups:[]});
  }
  mocks.rpc.mockResolvedValue({data:{students:[],bundles:[]},error:null});
  expect(await getAdminSchoolScheduleOverview()).toMatchObject({status:"ready",groups:[]});
});
it("프로필 스냅샷과 일정 조회 사이에 학교가 바뀌면 혼합 표시를 차단한다", async () => {
  mocks.rpc.mockResolvedValue({data:{students:[profile],bundles:[bundle]},error:null});
  expect((await getAdminSchoolScheduleMap([id],[{...profile,schoolKey:"J10:8888888"}]))[id].status).toBe("error");
});
it("학교별로 집계하고 학생 ID나 이름을 개요에 넘기지 않는다", async () => {
  mocks.rpc.mockResolvedValue({data:{students:[profile,{...profile,id:other}],bundles:[bundle]},error:null});
  const result=await getAdminSchoolScheduleOverview(); expect(result.groups[0].studentCount).toBe(2);
  expect(JSON.stringify(result)).not.toContain(id); expect(JSON.stringify(result)).not.toContain("displayName");
});
it("관리자 인증 실패 시 DB를 읽지 않는다", async () => {
  mocks.admin.mockRejectedValue(new Error("auth"));
  await expect(getAdminSchoolScheduleOverview()).rejects.toThrow("auth");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("학생은 현재 세션 ID만 서비스 조회에 쓰고 타인 반환을 거절한다", async () => {
  mocks.service.mockResolvedValue({data:{students:[profile],bundles:[bundle]},error:null});
  expect((await getCurrentStudentSchoolSchedule()).status).toBe("ready");
  expect(mocks.service).toHaveBeenCalledExactlyOnceWith("get_student_school_schedule_v1",{p_student_id:id});
  mocks.service.mockResolvedValue({data:{students:[{...profile,id:other}],bundles:[bundle]},error:null});
  expect((await getCurrentStudentSchoolSchedule()).status).toBe("error");
  mocks.student.mockRejectedValue(new Error("inactive-session")); mocks.service.mockClear();
  await expect(getCurrentStudentSchoolSchedule()).rejects.toThrow("inactive-session");
  expect(mocks.service).not.toHaveBeenCalled();
});
