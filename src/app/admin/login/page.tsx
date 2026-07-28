import type { Metadata } from "next";
import Link from "next/link";

import { AdminLoginForm } from "@/components/admin-login-form";
import { hasSupabaseEnvironment } from "@/lib/env";

export const metadata: Metadata = {
  title: "관리자 로그인",
};

export default function AdminLoginPage() {
  const configured = hasSupabaseEnvironment();

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">TEACHER ADMIN</p>
        <h1>관리자 로그인</h1>
        <p className="auth-description">
          직접 만든 관리자 계정으로만 들어갈 수 있습니다.
        </p>
        {!configured && (
          <div className="notice notice-warm section">
            Supabase 연결값을 설정한 뒤 로그인할 수 있습니다.
          </div>
        )}
        <AdminLoginForm />
        <Link className="back-link" href="/">
          ← 첫 화면으로
        </Link>
      </section>
    </main>
  );
}
