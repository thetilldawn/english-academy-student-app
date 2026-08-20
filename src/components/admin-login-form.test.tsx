// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLoginForm } from "./admin-login-form";

afterEach(cleanup);

describe("AdminLoginForm", () => {
  it("keeps credentials disabled until the client has hydrated", () => {
    const html = renderToString(<AdminLoginForm />);
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const form = parsed.querySelector("form");

    expect(form?.getAttribute("data-hydrated")).toBe("false");
    expect(form?.getAttribute("aria-busy")).toBe("true");
    expect(parsed.querySelector('input[name="email"]')?.hasAttribute("disabled"))
      .toBe(true);
    expect(parsed.querySelector('input[name="password"]')?.hasAttribute("disabled"))
      .toBe(true);
    expect(parsed.querySelector('button[type="submit"]')?.hasAttribute("disabled"))
      .toBe(true);
  });

  it("hydrates the disabled server form without a mismatch, then enables it", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<AdminLoginForm />);
    document.body.append(container);
    const onRecoverableError = vi.fn();
    const root = hydrateRoot(container, <AdminLoginForm />, {
      onRecoverableError,
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "관리자 로그인" }))
        .toBeEnabled(),
    );

    expect(screen.getByRole("textbox", { name: "관리자 이메일" }))
      .toBeEnabled();
    expect(screen.getByLabelText("비밀번호")).toBeEnabled();
    expect(onRecoverableError).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
