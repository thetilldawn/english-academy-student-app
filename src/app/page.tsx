import Link from "next/link";

import { hasSupabaseEnvironment } from "@/lib/env";

export default function HomePage() {
  const configured = hasSupabaseEnvironment();

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

        <p className="landing-copy">
          오늘 배정된 단어시험을 빠르게 풀고, 다시 봐야 할 단어만
          남겨두세요.
        </p>

        {!configured && (
          <div className="notice notice-warm" role="status">
            <strong>초기 연결 준비중</strong>
            <span>
              관리자가 Supabase 환경설정을 마치면 학생 접속이
              열립니다.
            </span>
          </div>
        )}

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
