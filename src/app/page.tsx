import Link from "next/link";
import { redirect } from "next/navigation";

import { StudentLoginForm } from "@/components/student-login-form";
import { getStudentSession } from "@/lib/auth/student-session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (await getStudentSession()) {
    redirect("/student");
  }

  return (
    <main className="landing-shell" id="main-content">
      <section className="landing-card">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <div>
            <p className="eyebrow">ENGLISH STUDY ROOM</p>
            <h1>영어 학습실</h1>
          </div>
        </div>

        <div className="landing-auth">
          <StudentLoginForm />
          <Link className="landing-admin-link" href="/admin/login">
            관리자 페이지 →
          </Link>
        </div>
      </section>
    </main>
  );
}
