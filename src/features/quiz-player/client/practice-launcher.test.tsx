/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNativeOverlayFixture } from "@/test-support/native-overlay-fixture";
installNativeOverlayFixture();
const mocks = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../api/practice-transport", async () => ({ ...await vi.importActual("../api/practice-transport"), requestPracticePreview: mocks.preview, requestPracticeStart: mocks.start }));
import { PracticeLauncher } from "./practice-launcher";
import { PracticeRequestError } from "../api/practice-transport";
const preview = { confirmation: "a".repeat(64), availableCount: 25, totalCount: 25, words: [], excluded: [], error: null };
const click = async (name: string) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
const filters = { datasetId: "", level: "all" as const, query: "", sort: "count" as const, minWrongCount: 2 };
const mount = () => render(<PracticeLauncher keys={["word:a", "word:b"]} filters={filters} totalCount={25} disabled={false} />);
beforeEach(() => { vi.resetAllMocks(); mocks.preview.mockResolvedValue(preview); });
afterEach(cleanup);
describe("자율연습 시작창", () => {
  it("선택 연습과 조건 전체를 구별하며 첫10개 키를 전체로 보내지 않는다", async () => {
    mount(); await click("조건 전체 연습"); await click("연습할 단어 확인");
    expect(mocks.preview.mock.calls[0][0].selection).toEqual({ mode: "filtered", filters });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("설정 변경은 확인을 무효화하고 같은 클릭 연타는 한번만 시작한다", async () => {
    mount(); await click("선택 연습"); await click("연습할 단어 확인");
    expect(mocks.preview.mock.calls[0][0].selection).toEqual({ mode: "selected", keys: ["word:a", "word:b"] });
    fireEvent.change(screen.getByRole("spinbutton", { name: "문항 수" }), { target: { value: "1" } });
    expect(screen.queryByRole("button", { name: "연습 시작" })).toBeNull(); await click("연습할 단어 확인");
    mocks.start.mockImplementation(() => new Promise(() => {}));
    const startButton = screen.getByRole("button", { name: "연습 시작" });
    await act(async () => { fireEvent.click(startButton); fireEvent.click(startButton); });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it("응답 유실503은 같은 요청을 확인하며 새 미리보기나 닫기를 허용하지 않는다", async () => {
    mocks.start.mockRejectedValue(new PracticeRequestError(503, "연결 오류"));
    mount(); await click("선택 연습"); await click("연습할 단어 확인"); await click("연습 시작");
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "문항 수" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "연습 내역 확인" })).toHaveAttribute("href", "/student/practice");
    await click("시작 결과 확인");
    expect(mocks.start.mock.calls[0][0]).toEqual(mocks.start.mock.calls[1][0]);
  });
  it("원천 변경409는 다시 확인할 수 있게 풀고 새 요청키로 확인한다", async () => {
    mocks.start.mockRejectedValue(new PracticeRequestError(409, "단어 변경", "source_changed"));
    mount(); await click("선택 연습"); await click("연습할 단어 확인"); await click("연습 시작");
    expect(screen.getByRole("button", { name: "닫기" })).toBeEnabled();
    await click("연습할 단어 확인");
    expect(mocks.preview.mock.calls[0][0].requestKey).not.toBe(mocks.preview.mock.calls[1][0].requestKey);
  });
  it("완료된 시작 영수증은 결과로 이동하며 권한 거절은 내용을 숨긴다", async () => {
    mocks.start.mockResolvedValueOnce({ attempt: { id: "saved", status: "completed" } });
    const view = mount(); await click("선택 연습"); await click("연습할 단어 확인"); await click("연습 시작");
    expect(mocks.push).toHaveBeenCalledWith("/student/practice/saved/result"); view.unmount();
    mocks.preview.mockRejectedValueOnce(new PracticeRequestError(401, "로그인 필요"));
    mount(); await click("선택 연습"); await click("연습할 단어 확인");
    expect(screen.queryByRole("spinbutton")).toBeNull(); expect(screen.getByRole("link", { name: "처음으로" })).toBeVisible();
  });
});
