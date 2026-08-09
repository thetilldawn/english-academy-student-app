import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("Sonner와 계정 단위 알림 UI 계약", () => {
  it("루트 Toaster 하나를 2초와 반응형 위치로 사용한다", () => {
    const layout = source("src/app/layout.tsx");
    const toaster = source("src/components/app-toaster.tsx");
    const css = source("src/app/globals.css");

    expect(layout.match(/<AppToaster/g)).toHaveLength(1);
    expect(toaster).toContain("duration={2000}");
    expect(toaster).toContain('mobile ? "top-center" : "top-right"');
    expect(toaster).toContain("closeButton");
    expect(css).toContain("[data-sonner-toaster]");
    expect(css).not.toContain(".app-toast[popover]");
  });

  it("학생과 관리자 보호 화면에서 같은 전달 컴포넌트를 사용한다", () => {
    const adminLayout = source("src/app/admin/(protected)/layout.tsx");
    const studentLayout = source("src/app/student/(protected)/layout.tsx");
    const bootstrap = source("src/components/notification-bootstrap.tsx");

    expect(adminLayout).toContain('<NotificationBootstrap role="admin" />');
    expect(studentLayout).toContain('<NotificationBootstrap role="student" />');
    expect(bootstrap).toContain("RECHECK_INTERVAL_MS");
    expect(bootstrap).toContain('document.visibilityState === "visible"');
    expect(bootstrap).toContain("} catch {");
    expect(bootstrap).not.toContain("AbortController");
  });
});
