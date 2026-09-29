"use client";
import type { ReactNode } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { LogoutContext, useLogoutTransition } from "../controller/use-logout-transition";
import styles from "./session-logout-boundary.module.css";
export function SessionLogoutBoundary({ children, role }: { children: ReactNode; role: "admin" | "student" }) {
  const transition = useLogoutTransition(role);
  return <LogoutContext value={transition}>
    {transition.state === "idle" ? children : (
      <main className={styles.screen} id="main-content" aria-busy={transition.state !== "failed"}>
        {transition.state === "failed" ? <>
          <p role="alert">로그아웃하지 못했습니다. 다시 시도해 주세요.</p>
          <Button onClick={() => void transition.logout()}>다시 로그아웃</Button>
        </> : <p role="status">로그아웃 중입니다.</p>}
      </main>
    )}
  </LogoutContext>;
}
