import type { Metadata } from "next";
import Link from "next/link";

import {
  listAssignments,
  listAttempts,
  listDatasets,
  listStudents,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "관리 현황",
};

export default async function AdminDashboardPage() {
  const [students, assignments, attempts, datasets] = await Promise.all([
    listStudents(),
    listAssignments(),
    listAttempts(),
    listDatasets(),
  ]);
  const activeStudents = students.filter(
    (student) => student.status === "active",
  ).length;
  const completedAttempts = attempts.filter(
    (attempt) => attempt.status === "completed",
  );
  const passedAttempts = completedAttempts.filter(
    (attempt) => attempt.passed,
  ).length;
  const readyDatasets = datasets.filter(
    (dataset) => dataset.status === "ready" && dataset.isActive,
  ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>수업 현황</h1>
          <p>학생 접속과 단어시험 상태를 한눈에 확인합니다.</p>
        </div>
        <Link className="button button-primary" href="/admin/assignments">
          새 시험 배정
        </Link>
      </div>

      <section className="grid grid-3">
        <article className="card metric">
          <span className="metric-value">{activeStudents}</span>
          <span className="metric-label">
            접속 가능 학생 / 전체 {students.length}명
          </span>
        </article>
        <article className="card metric">
          <span className="metric-value">{assignments.length}</span>
          <span className="metric-label">배정한 시험</span>
        </article>
        <article className="card metric">
          <span className="metric-value">
            {completedAttempts.length === 0
              ? "-"
              : `${Math.round(
                  (passedAttempts / completedAttempts.length) * 100,
                )}%`}
          </span>
          <span className="metric-label">완료 시험 통과율</span>
        </article>
      </section>

      <section className="section grid grid-2">
        <article className="card">
          <div className="section-heading">
            <h2>어휘 데이터</h2>
            <Link className="nav-link" href="/admin/assignments">
              시험 만들기 →
            </Link>
          </div>
          <p className="metric-value">{readyDatasets}</p>
          <p className="list-meta">검수 완료되어 시험에 쓸 수 있는 목록</p>
          {readyDatasets === 0 && (
            <div className="notice notice-warm section">
              최신 능률보카 파일을 가져온 뒤 시험 배정이 열립니다.
            </div>
          )}
        </article>
        <article className="card">
          <div className="section-heading">
            <h2>최근 응시</h2>
            <Link className="nav-link" href="/admin/results">
              전체 결과 →
            </Link>
          </div>
          {attempts.length === 0 ? (
            <div className="empty-state">아직 응시 기록이 없습니다.</div>
          ) : (
            <div className="compact-list">
              {attempts.slice(0, 5).map((attempt) => (
                <div className="compact-row" key={attempt.id}>
                  <span>
                    <strong>{attempt.studentName}</strong>
                    <small>{attempt.assignmentTitle}</small>
                  </span>
                  <span className={`status-pill status-${attempt.status}`}>
                    {attempt.status === "completed"
                      ? `${attempt.initialScore ?? "-"}점`
                      : attempt.status === "in_progress"
                        ? "응시 중"
                        : "시간 종료"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </>
  );
}
