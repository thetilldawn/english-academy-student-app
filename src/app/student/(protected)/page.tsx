import type { Metadata } from "next";
import Link from "next/link";

import { StartAttemptButton } from "@/components/start-attempt-button";
import { requireStudentSession } from "@/lib/auth/student-session";
import { listStudentAssignments } from "@/lib/services/quiz-service";

export const metadata: Metadata = {
  title: "내 단어시험",
};

function statusText(status: "in_progress" | "completed" | "expired" | null) {
  if (status === "in_progress") return "풀던 시험";
  if (status === "completed") return "완료";
  if (status === "expired") return "시간 종료";
  return "새 시험";
}

export default async function StudentDashboardPage() {
  const session = await requireStudentSession();
  const assignments = await listStudentAssignments(session.studentId);

  return (
    <main className="content student-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MY ASSIGNMENTS</p>
          <h1>{session.displayName}의 단어시험</h1>
          <p>배정된 시험을 선택하고 빠르게 풀어보세요.</p>
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="empty-state">
          아직 배정된 시험이 없습니다.
          <br />
          선생님이 시험을 배정하면 이곳에 표시됩니다.
        </div>
      ) : (
        <section className="grid grid-2">
          {assignments.map((assignment) => (
            <article className="card assignment-card" key={assignment.id}>
              <div className="title-with-status">
                <div>
                  <p className="eyebrow">{assignment.datasetTitle}</p>
                  <h2>{assignment.title}</h2>
                </div>
                <span
                  className={`status-pill status-${
                    assignment.lastStatus ?? "draft"
                  }`}
                >
                  {statusText(assignment.lastStatus)}
                </span>
              </div>
              <div className="assignment-details">
                <span className="detail-chip">
                  {assignment.rangeStart}~{assignment.rangeEnd}번
                </span>
                <span className="detail-chip">
                  {assignment.questionCount}문항
                </span>
                <span className="detail-chip">
                  {Math.ceil(assignment.timeLimitSeconds / 60)}분
                </span>
                <span className="detail-chip">
                  {assignment.passingScore}점 통과
                </span>
              </div>
              {assignment.lastInitialScore !== null && (
                <p className="last-score">
                  최근 첫 점수 <strong>{assignment.lastInitialScore}점</strong>
                </p>
              )}
              <div className="inline-actions">
                {assignment.lastStatus === "in_progress" &&
                  assignment.lastAttemptId && (
                    <Link
                      className="button button-primary"
                      href={`/student/attempt/${assignment.lastAttemptId}`}
                    >
                      이어 풀기
                    </Link>
                  )}
                {assignment.lastStatus === "completed" &&
                  assignment.lastAttemptId && (
                    <Link
                      className="button button-secondary"
                      href={`/student/result/${assignment.lastAttemptId}`}
                    >
                      결과 보기
                    </Link>
                  )}
                {assignment.lastStatus === "expired" &&
                  assignment.lastAttemptId && (
                    <Link
                      className="button button-quiet"
                      href={`/student/result/${assignment.lastAttemptId}`}
                    >
                      종료 결과
                    </Link>
                  )}
                {assignment.canStart &&
                  assignment.lastStatus !== "in_progress" && (
                    <StartAttemptButton assignmentId={assignment.id} />
                  )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
