/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentStudy } from "../contracts/assignment-study";
const mocks = vi.hoisted(() => ({ play: vi.fn(), dispose: vi.fn() }));
vi.mock("@/lib/audio/managed-audio-player", () => ({ ManagedAudioPlayer: class { play = mocks.play; dispose = mocks.dispose; } }));
import { AssignmentStudyWords } from "./assignment-study-words";
import { AssignmentStudyFrame } from "./assignment-study-frame";
import AssignmentStudyPageError from "@/app/student/(protected)/assignments/[id]/words/error";
const url = "https://media.merriam-webster.com/audio/prons/en/us/mp3/c/collec01.mp3";
const study: AssignmentStudy = { assignmentId: "test", title: "학습장", mode: "canonical_example_to_headword", words: [{ key: "word", headword: "collect", meaning: "모으다", definition: null, example: "She collected the letters.", pronunciation: { displayKo: "컬렉트", audioUrl: url, available: true, variantId: null } }] };
beforeEach(() => { vi.clearAllMocks(); mocks.play.mockResolvedValue("started"); });
afterEach(cleanup);
describe("단어장 음성·학습 표시", () => {
  it("조회 실패의 다시 시도는 오류 표시만 지우지 않고 서버 재조회 함수를 호출한다", () => {
    const retry = vi.fn();
    render(<AssignmentStudyPageError unstable_retry={retry} />);
    expect(screen.getByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("독립 페이지는 본문 랜드마크와 목록으로 돌아가는 닫기 링크를 유지한다", () => {
    render(<AssignmentStudyFrame presentation="page">학습 내용</AssignmentStudyFrame>);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("link", { name: "닫기" })).toHaveAttribute("href", "/student");
  });
  it("완성 예문과 단어 발음을 보여주고 단어 스피커만 만든다", async () => {
    const view = render(<AssignmentStudyWords study={study} />);
    expect(screen.getByText("She collected the letters.")).toBeVisible();
    expect(screen.getByText("모으다")).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "collect 단어 발음 듣기" })));
    expect(mocks.play).toHaveBeenCalledWith(url);
    view.unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("음성 차단·실패를 표시하고 다시 누르면 오류를 해제한다", async () => {
    mocks.play.mockResolvedValueOnce("blocked");
    render(<AssignmentStudyWords study={study} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("alert")).toHaveTextContent("음성을 재생하지 못했습니다");
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("없는 음성을 임의 생성하지 않고 비활성 스피커와 안내를 표시한다", () => {
    render(<AssignmentStudyWords study={{ ...study, words: [{ ...study.words[0]!, pronunciation: { available: false, audioUrl: null, displayKo: null, variantId: null } }] }} />);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByText(/발음 자료는 아직 준비되지/u)).toBeVisible();
  });
  it("영영풀이형에서는 풀이만 추가하고 예문을 섞지 않는다", () => {
    render(<AssignmentStudyWords study={{ ...study, mode: "canonical_definition_to_headword", words: [{ ...study.words[0]!, definition: "to gather things" }] }} />);
    expect(screen.getByText("to gather things")).toBeVisible();
    expect(screen.queryByText("She collected the letters.")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
