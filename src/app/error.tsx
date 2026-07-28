"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-card">
        <p className="eyebrow">잠시 문제가 생겼어요</p>
        <h1>화면을 불러오지 못했습니다</h1>
        <p className="auth-description">
          입력한 내용은 다시 확인할 수 있습니다. 잠시 뒤 재시도해주세요.
        </p>
        <button className="button button-primary" onClick={reset} type="button">
          다시 시도
        </button>
      </section>
    </main>
  );
}
