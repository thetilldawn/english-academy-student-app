// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { StudentHistoryPanel } from "./student-history-panel";
vi.mock("./student-wrong-word-panel",()=>({StudentWrongWordPanel:({active}:{active:boolean})=><span data-testid="wrong-fetch">{String(active)}</span>}));
vi.mock("./student-learning-history",()=>({StudentLearningHistory:()=>null}));
vi.mock("@/features/assignment-queue/public-ui",()=>({StudentAssignmentQueueHistory:()=>null}));
afterEach(cleanup);
it("starts folded, enables reads only while expanded on the active tab, and keeps the toggle accessible",()=>{
  const props={active:true,student:{id:"fake",currentVocabDatasetId:null,readingCurriculumStage:"undecided",readingContextSyncStatus:"not_synced"},wrongSummary:{wrongWordCount:24,repeatedWrongWordCount:1},wrongCache:{entry:null,actions:{cache:vi.fn()}},historyController:{actions:{refreshFirstPage:vi.fn()}}} as unknown as ComponentProps<typeof StudentHistoryPanel>;
  const {rerender}=render(<StudentHistoryPanel {...props}/>);
  const toggle=screen.getByRole("button",{name:"오답 단어 펼치기"});
  expect(toggle).toHaveAttribute("aria-expanded","false");
  expect(screen.getByTestId("wrong-fetch")).toHaveTextContent("false");
  expect(screen.getByTestId("wrong-fetch")).not.toBeVisible();
  fireEvent.click(toggle);
  expect(screen.getByTestId("wrong-fetch")).toHaveTextContent("true");
  expect(screen.getByTestId("wrong-fetch")).toBeVisible();
  rerender(<StudentHistoryPanel {...props} active={false}/>);
  expect(screen.getByTestId("wrong-fetch")).toHaveTextContent("false");
});
