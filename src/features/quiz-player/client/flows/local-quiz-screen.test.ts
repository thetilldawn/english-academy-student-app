// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { prepareLocalQuizScreen } from "./local-quiz-screen";
afterEach(()=>vi.unstubAllGlobals());
it("목록 위 모달은 목록을 제어하지 않는 worker의 준비 응답으로 시작할 수 있다",async()=>{
  class Port { peer!:Port;onmessage:((event:{data:unknown})=>void)|null=null;close(){} }
  class Channel {port1=new Port();port2=new Port();constructor(){this.port1.peer=this.port2;this.port2.peer=this.port1;}}
  vi.stubGlobal("MessageChannel",Channel);
  const worker={postMessage:vi.fn((_message:unknown,ports:Port[])=>queueMicrotask(()=>ports[0].peer.onmessage?.({data:{ready:true}})))};
  const serviceWorker={register:vi.fn(async()=>({active:worker})),controller:null,
    get ready():never{throw new Error("student document cannot be controlled by quiz-offline scope");}};
  vi.stubGlobal("navigator",{serviceWorker});
  await expect(prepareLocalQuizScreen(true)).resolves.toBeUndefined();
  expect(worker.postMessage).toHaveBeenCalledWith({type:"LOCAL_QUIZ_READY"},expect.any(Array));
});
