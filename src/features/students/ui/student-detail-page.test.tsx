// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type MouseEvent,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationExitGuardProvider } from "@/components/navigation-exit-guard";

import type { StudentDetailInitial } from "../contracts/student-detail-read-model";
import { StudentDetailPage } from "./student-detail-page";

const { navigateDocument, replace, softNavigate } = vi.hoisted(() => ({
  navigateDocument: vi.fn(),
  replace: vi.fn(),
  softNavigate: vi.fn(),
}));

vi.mock("@/components/document-navigation", () => ({ navigateDocument }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), replace }),
}));
vi.mock("next/link", async () => {
  const { forwardRef } = await vi.importActual<typeof import("react")>("react");
  return {
    default: forwardRef<HTMLAnchorElement, {
    children: ReactNode;
    href: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    onNavigate?: (event: { preventDefault: () => void }) => void;
    }>(function MockLink(
      { children, href, onClick, onNavigate, ...props },
      ref,
    ) {
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            onClick?.(event);
            if (event.defaultPrevented) return;
            let prevented = false;
            onNavigate?.({ preventDefault: () => { prevented = true; } });
            event.preventDefault();
            if (!prevented) softNavigate(href);
          }}
          ref={ref}
        >
          {children}
        </a>
      );
    }),
  };
});

const initial: StudentDetailInitial = {
  history: { items: [], nextCursor: null, totalCount: 0 },
  learningSources: [],
  snapshotAt: "2026-08-29T00:00:00.000Z",
  student: {
    codeStatus: "active",
    createdAt: "2026-08-29T00:00:00.000Z",
    currentVocabBook: null,
    currentVocabDatasetId: null,
    displayName: "프리뷰 검토 학생",
    gradeLabel: "고3",
    id: "00000000-0000-4000-8000-000000000001",
    rawPoints: 0,
    readingContextSyncStatus: "not_configured",
    readingCurriculumStage: "undecided",
    schoolName: "미리보기고",
    status: "active",
  },
  vocabBookHistory: [],
  wrongSummary: { repeatedWrongWordCount: 0, wrongWordCount: 0 },
};

function renderPage() {
  return render(
    <NavigationExitGuardProvider>
      <StudentDetailPage appOrigin="https://preview.example" initial={initial} />
    </NavigationExitGuardProvider>,
  );
}

function currentBaseState() {
  const state = { ...(window.history.state as Record<string, unknown>) };
  delete state.__routeExitGuardSentinel;
  return state;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/admin/students/student-1");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigateDocument.mockReset();
  replace.mockReset();
  softNavigate.mockReset();
  window.history.replaceState({}, "", "/");
});

describe("StudentDetailPage", () => {
  it("keeps an immediately edited profile when list navigation is cancelled", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    const name = screen.getByRole("textbox", { name: "이름" });
    await user.clear(name);
    await user.type(name, "수정 중 학생");
    await user.click(screen.getByRole("link", { name: "학생 목록" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(navigateDocument).not.toHaveBeenCalled();
    expect(softNavigate).not.toHaveBeenCalled();
    expect(name).toHaveValue("수정 중 학생");
    expect(window.location.pathname).toBe("/admin/students/student-1");
  });

  it("uses one document navigation after an edited profile exit is approved", async () => {
    const user = userEvent.setup();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    const name = screen.getByRole("textbox", { name: "이름" });
    await user.clear(name);
    await user.type(name, "수정 중 학생");
    const baseState = currentBaseState();
    await user.click(screen.getByRole("link", { name: "학생 목록" }));

    expect(back).toHaveBeenCalledOnce();
    expect(navigateDocument).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(baseState, "", window.location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: baseState }));
    });

    await waitFor(() =>
      expect(navigateDocument).toHaveBeenCalledWith("/admin/students", false),
    );
    expect(navigateDocument).toHaveBeenCalledOnce();
    expect(softNavigate).not.toHaveBeenCalled();
  });
});
