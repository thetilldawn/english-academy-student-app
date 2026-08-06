import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { AdminHistoryList } from "@/components/admin-history-list";
import { overviewActivityGroups } from "@/lib/admin/learning-activity";
import { listAssignmentHistory } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function AdminDashboardPage() {
  const history = await listAssignmentHistory();
  const groups = overviewActivityGroups(history);
  const sections = [
    {
      id: "missed",
      title: "미응시 마감",
      description: "마감까지 시작하지 않은 학습",
      items: groups.missed,
    },
    {
      id: "failed",
      title: "미통과·재시험 필요",
      description: "통과 기준에 도달하지 못한 학습",
      items: groups.failed,
    },
    {
      id: "due-soon",
      title: "마감 예정",
      description: "가까운 마감부터",
      items: groups.dueSoon,
    },
    {
      id: "no-deadline",
      title: "마감 없음",
      description: "오래 배정된 학습부터",
      items: groups.noDeadline,
    },
  ].filter((section) => section.items.length > 0);

  return (
    <>
      <AdminBreadcrumb current="Overview" />
      {sections.length === 0 ? (
        <div className="empty-state overview-clear-state">
          지금 확인할 미응시·미통과·대기 학습이 없습니다.
        </div>
      ) : (
        <div className="overview-action-groups">
          {sections.map((section) => (
            <section
              aria-labelledby={`overview-${section.id}`}
              className="overview-action-section"
              key={section.id}
            >
              <div className="section-heading">
                <div>
                  <h2 id={`overview-${section.id}`}>{section.title}</h2>
                  <p className="list-meta">{section.description}</p>
                </div>
                <span className="detail-chip">{section.items.length}명</span>
              </div>
              <AdminHistoryList compact items={section.items.slice(0, 8)} />
            </section>
          ))}
        </div>
      )}
    </>
  );
}
