/// <reference types="vite/client" />
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({admin:vi.fn(),student:vi.fn()}));
vi.mock("@/lib/auth/admin",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/auth/admin")>(),getAdminContext:mocks.admin,getAdminContextOrThrow:mocks.admin}));
vi.mock("@/lib/auth/student-session",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/auth/student-session")>(),getStudentSession:mocks.student}));
import { AdminAuthenticationUnavailableError } from "@/lib/auth/admin";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";

const sources=import.meta.glob<string>("../../app/api/**/route.ts",{query:"?raw",import:"default",eager:true});
const modules=import.meta.glob<Record<string,unknown>>("../../app/api/**/route.ts");
const id="00000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockRejectedValue(new AdminAuthenticationUnavailableError("AUTH_UPSTREAM_UNAVAILABLE",{cause:"private-detail"}));mocks.student.mockRejectedValue(new AuthenticationUnavailableError("private-detail"));});
for(const [path,source] of Object.entries(sources)){
  if(!/getAdminContext|getStudentSession/.test(source)) continue;
  for(const [,method] of source.matchAll(/export const (GET|POST|PATCH|DELETE|PUT) =/g)){
    if(path.includes("/session/") && (path.includes("/admin/") || method!=="GET")) continue;
    it(`${path} ${method}: 인증 장애는503이며 세션/개인정보를 반환하지 않는다`,async()=>{
      const routeModule=await modules[path]!();
      const handler=routeModule[method!] as (r:Request,c:{params:Promise<Record<string,string>>})=>Promise<Response>;
      const url="http://localhost"+path.slice("../../app".length).replace(/\/route\.ts$/u,"").replace(/\[[^\]]+\]/gu,id);
      const request=new Request(url,{method,headers:{origin:"http://localhost","content-type":"application/json"},...(method!=="GET"?{body:JSON.stringify({})}:{})});
      const response=await handler(request,{params:Promise.resolve({id,studentId:id,assignmentId:id,datasetId:id,seriesId:id,draftId:id})});
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const text=await response.text();
      expect(text).not.toMatch(/private-detail|fake-refresh-token|학생 인증이 필요|관리자 로그인이 필요/);
    });
  }
}
