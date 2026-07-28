import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatElapsed,
  formatKoreanDateTime,
} from "@/lib/format";
import { getAdminAttemptDetail } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "응시 상세",
};

function retryLabel(
  initialIsCorrect: boolean | null,
  retryIsCorrect: boolean | null,
) {
  if (initialIsCorrect === true) return "첫 풀이 정답";
  if (retryIsCorrect === true) return "재풀이 정답";
  if (retryIsCorrect === false) return "재풀이 오답";
  return "미완료";
}

export default async function AdminResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getAdminAttemptDetail(id);
  if (!result) notFound();

  const wrongQuestions = result.questions.filter(
    (question) => question.initialIsCorrect !== true,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ATTEMPT DETAIL</p>
          <h1>{result.studentName}</h1>
          <p>
            {result.assignmentTitle} · {result.attemptNumber}회 ·{" "}
            {formatKoreanDateTime(result.startedAt)}
          </p>
        </div>
        <Link className="button button-quiet" href="/admin/results">
          결과 목록
        </Link>
      </div>

      <section className="grid grid-3">
        <article className="card metric">
          <span className="metric-value">
            {result.initialScore ?? "-"}
            {result.initialScore !== null && <small>점</small>}
          </span>
          <span className="metric-label">첫 점수</span>
        </article>
        <article className="card metric">
          <span className="metric-value">
            {result.finalScore ?? "-"}
            {result.finalScore !== null && <small>점</small>}
          </span>
          <span className="metric-label">재풀이 후 점수</span>
        </article>
        <article className="card metric">
          <span className="metric-value">
            {result.unresolvedWrongCount ?? "-"}
          </span>
          <span className="metric-label">
            미해결 · {formatElapsed(result.elapsedSeconds)}
          </span>
        </article>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>첫 풀이 오답과 재풀이</h2>
          <span className="detail-chip">{wrongQuestions.length}문항</span>
        </div>
        {wrongQuestions.length === 0 ? (
          <div className="empty-state">첫 풀이에서 모두 맞혔습니다.</div>
        ) : (
          <div className="result-question-list">
            {wrongQuestions.map((question) => (
              <article className="card result-question" key={question.id}>
                <div className="title-with-status">
                  <div>
                    <p className="eyebrow">문항 {question.orderIndex}</p>
                    <h3>{question.headword || question.prompt}</h3>
                  </div>
                  <span
                    className={`status-pill ${
                      question.retryIsCorrect
                        ? "status-completed"
                        : "status-expired"
                    }`}
                  >
                    {retryLabel(
                      question.initialIsCorrect,
                      question.retryIsCorrect,
                    )}
                  </span>
                </div>
                <dl className="answer-detail">
                  <div>
                    <dt>문제</dt>
                    <dd>{question.prompt}</dd>
                  </div>
                  <div>
                    <dt>첫 선택</dt>
                    <dd>{question.initialChoice ?? "선택 안 함"}</dd>
                  </div>
                  <div>
                    <dt>재풀이</dt>
                    <dd>{question.retryChoice ?? "선택 안 함"}</dd>
                  </div>
                  <div>
                    <dt>정답</dt>
                    <dd>{question.correctAnswer}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
