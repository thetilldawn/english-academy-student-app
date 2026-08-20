import Link from "next/link";
import { redirect } from "next/navigation";

import { StudentLoginForm } from "@/components/student-login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentAppText } from "@/content/ko/student-app";
import styles from "@/design-system/patterns/auth/auth-layout.module.css";
import { getStudentSession } from "@/lib/auth/student-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (await getStudentSession()) {
    redirect("/student");
  }

  return (
    <main className={styles.landingShell} id="main-content">
      <section className={styles.landingCard}>
        <ThemeToggle placement="auth" />
        <div className={styles.brandLockup}>
          <span className={styles.brandMark} aria-hidden="true">
            E
          </span>
          <div>
            <h1>{studentAppText.landing.title}</h1>
          </div>
        </div>

        <div className={styles.landingAuth}>
          <StudentLoginForm />
          <Link className={styles.adminLink} href="/admin/login">
            {studentAppText.landing.adminLink}
          </Link>
        </div>
      </section>
    </main>
  );
}
