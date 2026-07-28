import type { Metadata } from "next";
import Link from "next/link";

import { StudentLoginForm } from "@/components/student-login-form";
import { hasSupabaseEnvironment } from "@/lib/env";

export const metadata: Metadata = {
  title: "학생 접속",
};

export default function StudentCodePage() {
  const configured = hasSupabaseEnvironment();

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">STUDENT ACCESS</p>
        <h1>접속코드 입력</h1>
        <p className="auth-description">
          선생님에게 받은 코드를 입력하면 이 기기에서 6개월간
          접속이 유지됩니다.
        </p>
        {!configured && (
          <div className="notice notice-warm section">
            학습실 연결 준비중입니다. 잠시 후 다시 확인해주세요.
          </div>
        )}
        <StudentLoginForm />
        <Link className="back-link" href="/">
          ← 첫 화면으로
        </Link>
      </section>
    </main>
  );
}
