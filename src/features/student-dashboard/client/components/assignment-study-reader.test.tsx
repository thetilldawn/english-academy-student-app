/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentStudy } from "../../contracts/assignment-study";
const mocks = vi.hoisted(() => ({ play: vi.fn(), dispose: vi.fn() }));
vi.mock("@/lib/audio/managed-audio-player", () => ({ ManagedAudioPlayer: class { play = mocks.play; dispose = mocks.dispose; } }));
import { AssignmentStudyReader } from "./assignment-study-reader";
const word = { key: "word", headword: "collect", meaning: "모으다", definition: "to gather things", example: "She collected the letters.", exampleRanges: [{ start: 4, end: 13 }], pronunciation: { displayKo: "컬렉트", audioUrl: "https://example.invalid/collect.mp3", available: true, variantId: null } };
const study: AssignmentStudy = { assignmentId: "study", title: "학습장", mode: "book_meaning_choice", words: [word] };
const english = () => screen.getByRole("button", { name: "영어 가리기" });
const meaning = () => screen.getByRole("button", { name: "뜻 가리기" });
const layer = (value: string) => screen.getByText(value).closest("[data-concealed]");
beforeEach(() => { vi.clearAllMocks(); mocks.play.mockResolvedValue("started"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("학생 단어장 가리기 조립", () => {
  it("영어와 뜻을 따로 가리되 둘 다 가리는 상태는 만들지 않는다", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<AssignmentStudyReader study={study} presentation="page" />);
    const headword = screen.getByText("collect");
    const translation = screen.getByText("모으다");
    expect(screen.queryByText("collected")).toBeNull();
    fireEvent.click(english());
    expect(english()).toHaveAttribute("aria-pressed", "true");
    expect(meaning()).toHaveAttribute("aria-pressed", "false");
    expect(layer("collect")).toHaveAttribute("data-concealed", "true");
    expect(layer("모으다")).toHaveAttribute("data-concealed", "false");
    expect(layer("collect")).toHaveAttribute("inert");
    expect(screen.queryByRole("button", { name: /단어 발음 듣기/u })).toBeNull();
    fireEvent.click(meaning());
    expect(english()).toHaveAttribute("aria-pressed", "false");
    expect(meaning()).toHaveAttribute("aria-pressed", "true");
    expect(layer("collect")).toHaveAttribute("data-concealed", "false");
    expect(layer("모으다")).toHaveAttribute("data-concealed", "true");
    fireEvent.click(english());
    expect(meaning()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(english());
    expect(layer("collect")).toHaveAttribute("data-concealed", "false");
    expect(layer("모으다")).toHaveAttribute("data-concealed", "false");
    expect(headword).toBe(screen.getByText("collect"));
    expect(translation).toBe(screen.getByText("모으다"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("뜻 가리기 재클릭은 양쪽 표시로 돌아간다", () => {
    render(<AssignmentStudyReader study={study} presentation="page" />);
    fireEvent.click(meaning()); fireEvent.click(meaning());
    expect(meaning()).toHaveAttribute("aria-pressed", "false");
    expect(english()).toHaveAttribute("aria-pressed", "false");
  });
  it("영영풀이는 그대로 읽고 영어 단어·발음만 가린다", () => {
    render(<AssignmentStudyReader study={{ ...study, mode: "canonical_definition_to_headword" }} presentation="page" />);
    expect(screen.queryByRole("button", { name: "뜻 가리기" })).toBeNull();
    fireEvent.click(english());
    expect(layer("collect")).toHaveAttribute("data-concealed", "true");
    expect(screen.getByText("to gather things").closest("[aria-hidden=true]")).toBeNull();
    expect(layer("컬렉트")).toHaveAttribute("data-concealed", "true");
  });
  it("완성 예문에서 승인 대상 구간만 블러로 유지하고 나머지 문장은 읽을 수 있다", () => {
    render(<AssignmentStudyReader study={{ ...study, mode: "canonical_example_to_headword" }} presentation="page" />);
    const target = screen.getByText("collected");
    const sentence = target.closest("p")!;
    fireEvent.click(english());
    expect(target).toHaveAttribute("data-concealed", "true");
    expect(sentence).not.toHaveAttribute("aria-hidden");
    expect(sentence).toHaveTextContent("She collected가린 단어 the letters.");
    fireEvent.click(english());
    expect(target).toBe(screen.getByText("collected"));
    expect(sentence.textContent).toBe(word.example);
  });
  it("문장 없음과 대상 위치 불명을 구분하고 추측한 단어를 가리지 않는다", () => {
    const view = render(<AssignmentStudyReader study={{ ...study, mode: "canonical_example_to_headword", words: [{ ...word, example: null }] }} presentation="page" />);
    expect(screen.getByText("등록된 학습 문장이 없습니다.")).toBeVisible();
    view.rerender(<AssignmentStudyReader study={{ ...study, mode: "canonical_example_to_headword", words: [{ ...word, exampleRanges: null }] }} presentation="page" />);
    fireEvent.click(english());
    expect(screen.getAllByText("예문에서 가릴 단어 위치를 확인할 수 없습니다.").length).toBeGreaterThan(0);
    expect(layer(word.example)).toHaveAttribute("aria-hidden", "true");
  });
  it("가리자마자 재생을 멈추고 늦은 음성 실패를 무시하며 재열기는 초기화한다", async () => {
    let finish!: (value: string) => void;
    mocks.play.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const view = render(<AssignmentStudyReader study={study} presentation="page" />);
    fireEvent.click(screen.getByRole("button", { name: /단어 발음 듣기/u }));
    fireEvent.click(english());
    expect(mocks.dispose).toHaveBeenCalledOnce();
    await act(async () => finish("failed"));
    expect(screen.queryByRole("alert")).toBeNull();
    view.unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
    render(<AssignmentStudyReader study={study} presentation="page" />);
    expect(english()).toHaveAttribute("aria-pressed", "false");
    expect(meaning()).toHaveAttribute("aria-pressed", "false");
  });
});
