// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuardedLink } from "./guarded-link";
import {
  NavigationExitGuardProvider,
  useNavigationExitGuardRegistration,
} from "./navigation-exit-guard";

const { navigated, navigateDocument } = vi.hoisted(() => ({
  navigated: vi.fn(),
  navigateDocument: vi.fn(),
}));

vi.mock("./document-navigation", () => ({ navigateDocument }));

vi.mock("next/link", async () => {
  const { forwardRef } = await vi.importActual<typeof import("react")>("react");
  return {
    default: forwardRef<HTMLAnchorElement, {
      children: ReactNode;
      href: string;
      onNavigate?: (event: { preventDefault: () => void }) => void;
    }>(function MockLink({ children, href, onNavigate }, ref) {
      return (
        <a
          href={href}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            let prevented = false;
            onNavigate?.({ preventDefault: () => { prevented = true; } });
            event.preventDefault();
            if (!prevented) navigated(href);
          }}
          ref={ref}
        >
          {children}
        </a>
      );
    }),
  };
});

afterEach(() => {
  cleanup();
  navigated.mockReset();
  navigateDocument.mockReset();
});

function GuardFixture({ allow, requested }: {
  allow: boolean;
  requested: () => void;
}) {
  const requestExit = useCallback((continueNavigation: () => void) => {
    requested();
    if (allow) continueNavigation();
    return allow;
  }, [allow, requested]);
  useNavigationExitGuardRegistration({
    active: true,
    id: "test-editor",
    requestExit,
  });
  return <GuardedLink href="/admin/results">내역</GuardedLink>;
}

describe("GuardedLink", () => {
  it("활성 편집기가 이동을 취소하면 Next Link 이동을 막는다", async () => {
    const requested = vi.fn();
    render(
      <NavigationExitGuardProvider>
        <GuardFixture allow={false} requested={requested} />
      </NavigationExitGuardProvider>,
    );

    await userEvent.click(screen.getByRole("link", { name: "내역" }));

    expect(requested).toHaveBeenCalledOnce();
    expect(navigated).not.toHaveBeenCalled();
  });

  it("활성 편집기가 이동을 승인하면 병렬 화면을 남기지 않는 문서 이동을 사용한다", async () => {
    const requested = vi.fn();
    render(
      <NavigationExitGuardProvider>
        <GuardFixture allow requested={requested} />
      </NavigationExitGuardProvider>,
    );

    await userEvent.click(screen.getByRole("link", { name: "내역" }));

    expect(requested).toHaveBeenCalledOnce();
    expect(navigateDocument).toHaveBeenCalledWith("/admin/results", false);
    expect(navigated).not.toHaveBeenCalled();
  });

  it("활성 편집기가 없으면 기존 Next Link 이동을 유지한다", async () => {
    render(
      <NavigationExitGuardProvider>
        <GuardedLink href="/admin/results">내역</GuardedLink>
      </NavigationExitGuardProvider>,
    );

    await userEvent.click(screen.getByRole("link", { name: "내역" }));

    expect(navigateDocument).not.toHaveBeenCalled();
    expect(navigated).toHaveBeenCalledWith("/admin/results");
  });
});
