"use client";
import { Button } from "@/design-system/primitives/button/button";
import { studentAppText } from "@/content/ko/student-app";
import { useSessionLogout } from "@/features/session/public-client";
export function StudentLogoutButton() {
  const { state, logout } = useSessionLogout();
  return <Button disabled={state !== "idle"} onClick={() => void logout()} size="small" variant="quiet">
    {state === "idle" ? studentAppText.shell.logout : studentAppText.shell.logoutPending}
  </Button>;
}
