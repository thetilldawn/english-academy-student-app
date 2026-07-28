import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
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

        <div className="landing-actions">
          <Link className="button button-primary button-large" href="/code">
            학생 접속코드 입력
          </Link>
          <Link className="button button-quiet" href="/admin/login">
            관리자 로그인
          </Link>
        </div>
      </section>
      <p className="landing-footnote">
        공개 회원가입 없이 선생님이 전달한 코드로 접속합니다.
      </p>
    </main>
  );
}
