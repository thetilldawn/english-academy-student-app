// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminShellText } from "@/content/ko/admin-shell";
import { NavigationExitGuardProvider } from "./navigation-exit-guard";
import { useRouteExitGuard } from "./use-route-exit-guard";
import { AdminLogoutButton } from "./admin-logout-button";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  requestAdminLogout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock("@/features/session/api/session", () => ({
  requestAdminLogout: mocks.requestAdminLogout,
}));

const SENTINEL_KEY = "__routeExitGuardSentinel";

function DirtyEditorRegistration() {
  useRouteExitGuard({
    busy: false,
    confirmMessage: "변경 내용을 버리고 이동할까요?",
    dirty: true,
    idPrefix: "logout-test",
  });
  return <AdminLogoutButton />;
}

function releaseRouteGuardSentinel() {
  const state = { ...(window.history.state as Record<string, unknown>) };
  delete state[SENTINEL_KEY];
  window.history.replaceState(state, "", window.location.href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  window.history.replaceState({}, "", "/admin/students/student-1");
  vi.spyOn(window.history, "back").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function renderLogout() {
  return render(
    <NavigationExitGuardProvider>
      <DirtyEditorRegistration />
    </NavigationExitGuardProvider>,
  );
}

describe("AdminLogoutButton", () => {
  it("로그아웃 실패 뒤 보호를 복구하고 두 번째 시도는 정상 이동한다", async () => {
    const user = userEvent.setup();
    mocks.requestAdminLogout
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderLogout();

    await user.click(screen.getByRole("button", { name: adminShellText.logout.idle }));
    act(releaseRouteGuardSentinel);

    await waitFor(() => {
      expect(screen.getByText(adminShellText.logout.error)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(window.history.state[SENTINEL_KEY]).toEqual(expect.any(String));
    });
    expect(mocks.replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: adminShellText.logout.idle }));
    act(releaseRouteGuardSentinel);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/admin/login");
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.requestAdminLogout).toHaveBeenCalledTimes(2);
  });

  it("로그아웃 요청이 예외로 끝나도 오류를 표시하고 보호를 복구한다", async () => {
    const user = userEvent.setup();
    mocks.requestAdminLogout.mockRejectedValueOnce(new Error("network"));
    renderLogout();

    await user.click(screen.getByRole("button", { name: adminShellText.logout.idle }));
    act(releaseRouteGuardSentinel);

    await waitFor(() => {
      expect(screen.getByText(adminShellText.logout.error)).toBeInTheDocument();
      expect(window.history.state[SENTINEL_KEY]).toEqual(expect.any(String));
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
