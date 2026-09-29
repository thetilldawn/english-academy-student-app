"use client";
import { useGuardedNavigationRequest } from "@/components/navigation-exit-guard";
import { adminShellText } from "@/content/ko/admin-shell";
import { Button } from "@/design-system/primitives/button/button";
import { useSessionLogout } from "@/features/session/public-client";
export function AdminLogoutButton() {
  const requestNavigation = useGuardedNavigationRequest();
  const { state, logout } = useSessionLogout();
  const performLogout = () => logout();
  function requestLogout() {
    if (state !== "idle") return;
    if (requestNavigation(performLogout)) return;
    void performLogout();
  }
  return <Button disabled={state !== "idle"} onClick={requestLogout} size="small" variant="quiet">
    {state === "idle" ? adminShellText.logout.idle : adminShellText.logout.pending}
  </Button>;
}
