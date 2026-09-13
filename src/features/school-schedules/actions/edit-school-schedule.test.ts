import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({save:vi.fn(),recover:vi.fn(),refresh:vi.fn()}));
vi.mock("next/cache",()=>({refresh:m.refresh}));
vi.mock("../server/actions/school-schedule-edit-actions",()=>({saveSchoolScheduleEventAction:m.save,readSchoolScheduleSaveResultAction:m.recover,readSchoolScheduleEditorAction:vi.fn(),refreshSchoolScheduleOverviewAction:vi.fn()}));
import { saveSchoolScheduleEventAction,readSchoolScheduleSaveResultAction } from "./edit-school-schedule";
beforeEach(()=>vi.resetAllMocks());
it("저장 또는 복구가 확인된 경우만 탐색 보관값을 갱신한다",async()=>{
 m.save.mockResolvedValue({ok:false,status:409});await saveSchoolScheduleEventAction({});expect(m.refresh).not.toHaveBeenCalled();
 m.recover.mockResolvedValue({ok:true,receipt:null});await readSchoolScheduleSaveResultAction({});expect(m.refresh).not.toHaveBeenCalled();
 const result={ok:true,receipt:{revision:1}};m.save.mockResolvedValue(result);expect(await saveSchoolScheduleEventAction({})).toEqual(result);expect(m.refresh).toHaveBeenCalledTimes(1);
 m.recover.mockResolvedValue(result);await readSchoolScheduleSaveResultAction({});expect(m.refresh).toHaveBeenCalledTimes(2);
});
