/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), balance: vi.fn(), summary: vi.fn(), log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/student-session", () => ({ requireStudentSession: mocks.session }));
vi.mock("@/lib/services/learning-point-read-service", () => ({
  getStudentPointBalance: mocks.balance,
  getStudentAttemptPointSummary: mocks.summary,
}));
vi.mock("@/lib/observability/server-log", () => ({ logServerError: mocks.log }));

import { StudentHeaderPoints } from "./student-header-points";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ studentId: "fake-student-current" });
  mocks.balance.mockResolvedValue(23);
  mocks.summary.mockResolvedValue({ attemptPoints: 8, currentPoints: 31 });
});
afterEach(cleanup);

describe("StudentHeaderPoints", () => {
  it.each([{ segments: [] }, { segments: ["assignments", "fake-assignment", "words"] }])(
    "reads only the current authenticated student's balance for $segments", async ({ segments }) => {
      render(await StudentHeaderPoints({ segments }));
      expect(mocks.session).toHaveBeenCalledOnce();
      expect(mocks.balance).toHaveBeenCalledExactlyOnceWith("fake-student-current");
      expect(mocks.summary).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("23");
    },
  );

  it("adds no point read during a focused attempt", async () => {
    expect(await StudentHeaderPoints({ segments: ["attempt", "fake-attempt"] })).toBeNull();
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  it("reuses the existing result summary, including a real zero", async () => {
    mocks.summary.mockResolvedValue({ attemptPoints: 0, currentPoints: 0 });
    render(await StudentHeaderPoints({ segments: ["result", "fake-attempt"] }));
    expect(mocks.summary).toHaveBeenCalledExactlyOnceWith("fake-student-current", "fake-attempt");
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("포인트0");
  });

  it("reads a balance for a historical result without point events", async () => {
    mocks.summary.mockResolvedValue(null);
    render(await StudentHeaderPoints({ segments: ["result", "historical-attempt"] }));
    expect(mocks.balance).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("23");
  });

  it("isolates a failed read without fabricating zero", async () => {
    mocks.balance.mockRejectedValue(new Error("read unavailable"));
    render(await StudentHeaderPoints({ segments: [] }));
    expect(screen.getByRole("status")).toHaveTextContent("확인 불가");
    expect(mocks.log).toHaveBeenCalledOnce();
  });

  it("does not swallow the authentication redirect or read private data before it", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.session.mockRejectedValue(redirect);
    await expect(StudentHeaderPoints({ segments: [] })).rejects.toBe(redirect);
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
