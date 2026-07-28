import type { Metadata } from "next";
import Link from "next/link";

import { StudentLoginForm } from "@/components/student-login-form";

export const metadata: Metadata = {
  title: "학생 접속",
};

export default function StudentCodePage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">STUDENT ACCESS</p>
        <h1>접속코드 입력</h1>
        <p className="auth-description">
          선생님에게 받은 코드를 입력하면 이 기기에서 6개월간
          접속이 유지됩니다.
        </p>
        <StudentLoginForm />
        <Link className="back-link" href="/">
          ← 첫 화면으로
        </Link>
      </section>
    </main>
  );
}
