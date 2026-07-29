import type { Metadata } from "next";
import Link from "next/link";

import { formatKoreanDateTime } from "@/lib/format";
import { listAttempts } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "내역",
};

export default async function ResultsPage() {
  const attempts = await listAttempts();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h1 id="results-heading">내역</h1>
          <p>학생별 첫 시험, 재시험, 시작·종료 시각을 확인합니다.</p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="empty-state">아직 응시 기록이 없습니다.</div>
      ) : (
        <>
          <div className="results-card-list">
            {attempts.map((attempt) => (
              <Link
                className="card result-history-card"
                href={`/admin/results/${attempt.id}`}
                key={attempt.id}
              >
                <div className="title-with-status">
                  <div>
                    <strong>{attempt.studentName}</strong>
                    <span>{attempt.assignmentTitle}</span>
                  </div>
                  <span
                    className={`status-pill status-${attempt.status}`}
                  >
                    {attempt.status === "completed"
                      ? "완료"
                      : attempt.status === "in_progress"
                        ? "응시 중"
                        : "시간 종료"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>첫 시험 정답</dt>
                    <dd>
                      {attempt.initialCorrectCount === null
                        ? "-"
                        : `${attempt.initialCorrectCount}/${attempt.questionCount}`}
                    </dd>
                  </div>
                  <div>
                    <dt>최종 점수</dt>
                    <dd>
                      {attempt.finalScore === null
                        ? "-"
                        : `${attempt.finalScore}점`}
                    </dd>
                  </div>
                  <div>
                    <dt>다시 볼 단어</dt>
                    <dd>{attempt.unresolvedWrongCount ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>회차</dt>
                    <dd>{attempt.attemptNumber}</dd>
                  </div>
                </dl>
                <small>
                  시작 {formatKoreanDateTime(attempt.startedAt)}
                  {attempt.completedAt
                    ? ` · 종료 ${formatKoreanDateTime(
                        attempt.completedAt,
                      )}`
                    : ""}
                </small>
              </Link>
            ))}
          </div>
          <p className="table-scroll-hint">
            표를 좌우로 움직이면 모든 결과 항목을 확인할 수 있습니다.
          </p>
          <div
            aria-labelledby="results-heading"
            className="table-wrap results-table-wrap"
            role="region"
            tabIndex={0}
          >
          <table className="results-table">
            <caption className="sr-only">
              학생별 단어 시험 응시 결과
            </caption>
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">시험</th>
                <th scope="col">회차</th>
                <th scope="col">상태</th>
                <th scope="col">첫 시험 정답</th>
                <th scope="col">최종 점수</th>
                <th scope="col">다시 볼 단어</th>
                <th scope="col">통과</th>
                <th scope="col">시작</th>
                <th scope="col">종료</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.studentName}</td>
                  <td>
                    <Link
                      className="table-link"
                      href={`/admin/results/${attempt.id}`}
                    >
                      {attempt.assignmentTitle}
                    </Link>
                  </td>
                  <td>{attempt.attemptNumber}</td>
                  <td>
                    <span
                      className={`status-pill status-${attempt.status}`}
                    >
                      {attempt.status === "completed"
                        ? "완료"
                        : attempt.status === "in_progress"
                          ? "응시 중"
                          : "시간 종료"}
                    </span>
                  </td>
                  <td>
                    <Link
                      className="table-link"
                      href={`/admin/results/${attempt.id}`}
                    >
                      {attempt.initialCorrectCount === null
                        ? "-"
                        : `${attempt.initialCorrectCount}/${attempt.questionCount}`}
                    </Link>
                  </td>
                  <td>
                    {attempt.finalScore === null
                      ? "-"
                      : `${attempt.finalScore}점`}
                  </td>
                  <td>{attempt.unresolvedWrongCount ?? "-"}</td>
                  <td>
                    {attempt.passed === null
                      ? "-"
                      : attempt.passed
                        ? "통과"
                        : "미통과"}
                  </td>
                  <td>{formatKoreanDateTime(attempt.startedAt)}</td>
                  <td>
                    {attempt.completedAt
                      ? formatKoreanDateTime(attempt.completedAt)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </>
  );
}
