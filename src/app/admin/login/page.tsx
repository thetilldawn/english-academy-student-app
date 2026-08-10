import type { Metadata } from "next";
import Link from "next/link";

import { AdminLoginForm } from "@/components/admin-login-form";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { ThemeToggle } from "@/components/theme-toggle";
import { adminShellText } from "@/content/ko/admin-shell";

export const metadata: Metadata = {
  title: adminShellText.login.title,
};

export default function AdminLoginPage() {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-card">
        <ThemeToggle placement="auth" />
        <p className="eyebrow">{adminShellText.login.eyebrow}</p>
        <h1 className={inlineHelpClassName}>
          {adminShellText.login.title}
          <HelpTip label={adminShellText.login.helpAria}>
            {adminShellText.login.accountScopeHelp}
          </HelpTip>
        </h1>
        <AdminLoginForm />
        <Link className="back-link" href="/">
          {adminShellText.login.backToStudent}
        </Link>
      </section>
    </main>
  );
}
