// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudentCurrentAssignments } from "./student-current-assignments";
import { loadStudentDashboardSectionPage } from "../transport/student-dashboard-pages";
import { StudentDashboardRequestError } from "../contracts/student-dashboard-request-error";
import type { StudentAssignmentSummary } from "../contracts/student-dashboard-read-model";
vi.mock("../transport/student-dashboard-pages",()=>({loadStudentDashboardSectionPage:vi.fn()}));
vi.mock("./student-assignment-card",()=>({StudentAssignmentCard:({assignment}:{assignment:StudentAssignmentSummary})=><article>{assignment.id}</article>}));
const nav=vi.hoisted(()=>vi.fn());
vi.mock("@/components/document-navigation",()=>({navigateDocument:nav}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const items=(offset:number,count:number)=>Array.from({length:count},(_,i)=>({id:"가짜 "+(offset+i)} as StudentAssignmentSummary));
function mount(){return render(<StudentCurrentAssignments initialPage={{items:items(1,10),nextCursor:"next"}} sectionId="open" title="응시할 시험" nowMilliseconds={0} totalCount={21}/>);}
it("처음10개와 전체개수, 클릭마다10개·마지막1개를 원래순서로 추가한다",async()=>{
  vi.mocked(loadStudentDashboardSectionPage).mockResolvedValueOnce({items:items(11,10),nextCursor:"last"}).mockResolvedValueOnce({items:items(21,1),nextCursor:null});
  mount();expect(screen.getAllByRole("article")).toHaveLength(10);expect(screen.getByText("21건")).toBeInTheDocument();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"10개 더보기"})));
  expect(screen.getAllByRole("article")).toHaveLength(20);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"10개 더보기"})));
  expect(screen.getAllByRole("article").map(x=>x.textContent)).toEqual(items(1,21).map(x=>x.id));
  expect(screen.queryByRole("button",{name:"10개 더보기"})).not.toBeInTheDocument();
});
it("다음페이지 실패는 기존목록·커서를 보존하고 같은버튼으로 재시도한다",async()=>{
  vi.mocked(loadStudentDashboardSectionPage).mockRejectedValueOnce(new Error("internal")).mockResolvedValueOnce({items:items(11,1),nextCursor:null});
  mount();await act(async()=>fireEvent.click(screen.getByRole("button",{name:"10개 더보기"})));
  expect(screen.getAllByRole("article")).toHaveLength(10);
  expect(screen.getByRole("alert")).toHaveTextContent("다시 시도해 주세요.");
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"10개 더보기"})));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("인증거절은 카드·전체개수·더보기를 숨긴다",async()=>{
  vi.mocked(loadStudentDashboardSectionPage).mockRejectedValueOnce(new StudentDashboardRequestError(401));
  mount();await act(async()=>fireEvent.click(screen.getByRole("button",{name:"10개 더보기"})));
  expect(screen.queryAllByRole("article")).toHaveLength(0);expect(screen.queryByText("21건")).not.toBeInTheDocument();expect(nav).toHaveBeenCalledWith("/",true);
});
it("공개예정을 열고 더보기 해도 다른구역은 그대로다",async()=>{
  vi.mocked(loadStudentDashboardSectionPage).mockResolvedValue({items:items(11,10),nextCursor:null});
  const {container}=mount();
  render(<StudentCurrentAssignments initialPage={{items:items(1,10),nextCursor:"scheduled"}} sectionId="scheduled" title="공개 예정" nowMilliseconds={0} totalCount={20}/>);
  fireEvent.click(screen.getByRole("button",{name:/공개 예정/}));
  const scheduled=screen.getByRole("button",{name:/공개 예정/}).closest("[data-assignment-section]") as HTMLElement;
  await act(async()=>fireEvent.click(within(scheduled).getByRole("button",{name:"10개 더보기"})));
  expect(within(scheduled).getAllByRole("article")).toHaveLength(20);expect(within(container).getAllByRole("article")).toHaveLength(10);
});
