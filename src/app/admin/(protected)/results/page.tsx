import type { Metadata } from "next";
import Link from "next/link";

import { formatKoreanDateTime } from "@/lib/format";
import { listAttempts } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "시험 결과",
};

export default async function ResultsPage() {
  const attempts = await listAttempts();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h1>시험 결과</h1>
          <p>첫 점수와 재풀이 후 점수를 나눠 확인합니다.</p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="empty-state">아직 응시 기록이 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>학생</th>
                <th>시험</th>
                <th>회차</th>
                <th>상태</th>
                <th>첫 점수</th>
                <th>재풀이 후</th>
                <th>통과</th>
                <th>시작</th>
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
                    {attempt.initialScore === null
                      ? "-"
                      : `${attempt.initialScore}점`}
                  </td>
                  <td>
                    {attempt.finalScore === null
                      ? "-"
                      : `${attempt.finalScore}점`}
                  </td>
                  <td>
                    {attempt.passed === null
                      ? "-"
                      : attempt.passed
                        ? "통과"
                        : "미통과"}
                  </td>
                  <td>{formatKoreanDateTime(attempt.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
