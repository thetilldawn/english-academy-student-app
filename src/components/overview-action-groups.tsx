"use client";

import { useState, type ComponentProps } from "react";

import { AdminHistoryList } from "@/components/admin-history-list";
import { StudentManager } from "@/components/student-manager";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

type StudentManagerBaseProps = Omit<
  ComponentProps<typeof StudentManager>,
  "initialStudentId" | "launcherOnly" | "onLauncherClose"
>;

type OverviewSection = {
  id: string;
  title: string;
  description: string;
  items: AssignmentHistorySummary[];
};

export function OverviewActionGroups({
  sections,
  studentManagerProps,
}: {
  sections: OverviewSection[];
  studentManagerProps: StudentManagerBaseProps;
}) {
  const [selectedStudentId, setSelectedStudentId] = useState("");

  return (
    <>
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
              <span className="detail-chip">{section.items.length}건</span>
            </div>
            <AdminHistoryList
              compact
              items={section.items}
              onSelectStudent={setSelectedStudentId}
            />
          </section>
        ))}
      </div>

      {selectedStudentId ? (
        <StudentManager
          {...studentManagerProps}
          initialStudentId={selectedStudentId}
          key={selectedStudentId}
          launcherOnly
          onLauncherClose={() => setSelectedStudentId("")}
        />
      ) : null}
    </>
  );
}
