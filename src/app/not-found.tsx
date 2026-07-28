import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">404</p>
        <h1>찾을 수 없는 화면입니다</h1>
        <p className="auth-description">
          주소가 바뀌었거나 접근할 수 없는 항목입니다.
        </p>
        <Link className="button button-primary" href="/">
          처음으로
        </Link>
      </section>
    </main>
  );
}
