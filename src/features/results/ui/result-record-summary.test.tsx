/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resultRecordFixture, resultRecordWire } from "@/test-support/vocabulary-result-fixture";
import { ResultRecordSummary } from "./result-record-summary";
afterEach(cleanup);

describe("단계별 결과 안내", () => {
  it("최초40/50과 재시험8/10, 공식 최종96점과 날짜를 함께 보여준다", () => {
    render(<ResultRecordSummary record={resultRecordFixture()} />);
    const area = screen.getByLabelText("시험 기록");
    expect(area).toHaveTextContent("대상 50개 · 정답 40개 · 오답 10개 · 미응답 0개");
    expect(area).toHaveTextContent("대상 10개 · 정답 8개 · 오답 2개 · 미응답 0개");
    expect(area).toHaveTextContent("재시험 후 최종 점수96점 · 통과");
    expect(screen.getByText("이 시험은 결과와 오답 기록을 보관합니다.")).toBeVisible();
  });
  it.each(["retry_waiting", "retry_in_progress"] as const)("%s를 종료로 표시하지 않는다", state => {
    render(<ResultRecordSummary record={resultRecordFixture({ state, finalized: false, retryStarted: state === "retry_in_progress", finalizedAt: null, finalReason: null, phases: resultRecordWire().phases.slice(0, 1) })} />);
    expect(screen.getByText(/최종 결과.*확정/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "재시험" })).not.toBeInTheDocument();
  });
  it("없는 상세와 없는 과거 시각을 분명히 알려준다", () => {
    const wire = resultRecordWire({ detailScope: "summary_only" });
    wire.phases[1].started_at = null;
    render(<ResultRecordSummary record={resultRecordFixture(wire)} />);
    expect(screen.getByText("결과 요약만 보관된 시험입니다.")).toBeVisible();
    expect(screen.getByText("당시 기록되지 않은 시각입니다.")).toBeVisible();
  });
});
