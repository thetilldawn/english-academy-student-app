import type { Metadata } from "next";
import Link from "next/link";

import { AdminLoginForm } from "@/components/admin-login-form";
import {
  HelpTip,
  inlineHelpClassName,
} from "@/design-system/primitives/tooltip/help-tip";
import { ThemeToggle } from "@/components/theme-toggle";
import { adminShellText } from "@/content/ko/admin-shell";
import styles from "@/design-system/patterns/auth/auth-layout.module.css";

export const metadata: Metadata = {
  title: adminShellText.login.title,
};

export default function AdminLoginPage() {
  return (
    <main className={styles.authShell} id="main-content">
      <section className={styles.authCard}>
        <ThemeToggle placement="auth" />
        <p className={styles.eyebrow}>{adminShellText.login.eyebrow}</p>
        <h1 className={inlineHelpClassName}>
          {adminShellText.login.title}
          <HelpTip label={adminShellText.login.helpAria}>
            {adminShellText.login.accountScopeHelp}
          </HelpTip>
        </h1>
        <AdminLoginForm />
        <Link className={styles.backLink} href="/">
          {adminShellText.login.backToStudent}
        </Link>
      </section>
    </main>
  );
}
