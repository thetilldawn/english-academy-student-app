import Link from "next/link";
import { redirect } from "next/navigation";

import { StudentLoginForm } from "@/components/student-login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { studentAppText } from "@/content/ko/student-app";
import { getStudentSession } from "@/lib/auth/student-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (await getStudentSession()) {
    redirect("/student");
  }

  return (
    <main className="landing-shell" id="main-content">
      <section className="landing-card">
        <ThemeToggle placement="auth" />
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <p className="eyebrow">{studentAppText.landing.eyebrow}</p>
            <h1>{studentAppText.landing.title}</h1>
          </div>
        </div>

        <div className="landing-auth">
          <StudentLoginForm />
          <Link className="landing-admin-link" href="/admin/login">
            {studentAppText.landing.adminLink}
          </Link>
        </div>
      </section>
    </main>
  );
}
