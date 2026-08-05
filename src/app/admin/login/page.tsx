import type { Metadata } from "next";
import Link from "next/link";

import { AdminLoginForm } from "@/components/admin-login-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "관리자 로그인",
};

export default function AdminLoginPage() {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-card">
        <ThemeToggle className="theme-toggle-auth" />
        <p className="eyebrow">TEACHER ADMIN</p>
        <h1>관리자 로그인</h1>
        <p className="auth-description">
          직접 만든 관리자 계정으로만 들어갈 수 있습니다.
        </p>
        <AdminLoginForm />
        <Link className="back-link" href="/">
          ← 학생 인증 화면
        </Link>
      </section>
    </main>
  );
}
