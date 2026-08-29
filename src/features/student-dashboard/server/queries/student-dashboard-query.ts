import "server-only";

import { z } from "zod";

import type {
  StudentDashboardCompletedPage,
  StudentDashboardInitialSnapshot,
} from "@/features/student-dashboard/contracts/student-dashboard-read-model";
import type { StudentSession } from "@/lib/auth/student-session";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { selectStudentAssignmentSections } from "@/features/student-dashboard/domain/student-assignment-sections";

import {
  assertStudentDashboardCursorOwner,
  decodeStudentDashboardCursor,
  encodeStudentDashboardCursor,
  studentDashboardStudentFingerprint,
} from "../student-dashboard-cursor";
import { StudentDashboardReadError } from "./student-dashboard-read-error";
import {
  type StudentDashboardCompletedNode,
  mapStudentDashboardItem,
  studentDashboardCompletedPageRowSchema,
  studentDashboardInitialRowSchema,
} from "./student-dashboard-row-schema";

const PAGE_SIZE = 10;
const DATABASE_PAGE_LIMIT = PAGE_SIZE + 1;

function nextCursorFromNodes(input: {
  nodes: readonly StudentDashboardCompletedNode[];
  snapshotAt: string;
  studentId: string;
}) {
  if (input.nodes.length <= PAGE_SIZE) return null;
  const lastVisible = input.nodes[PAGE_SIZE - 1];
  if (!lastVisible) return null;
  return encodeStudentDashboardCursor({
    assignmentId: lastVisible.assignmentId,
    effectiveAt: lastVisible.effectiveAt,
    snapshotAt: input.snapshotAt,
    studentFingerprint: studentDashboardStudentFingerprint(input.studentId),
    version: 1,
  });
}

function completedPageFromNodes(input: {
  nodes: readonly StudentDashboardCompletedNode[];
  snapshotAt: string;
  studentId: string;
}): StudentDashboardCompletedPage {
  return {
    items: input.nodes
      .slice(0, PAGE_SIZE)
      .map((node) => mapStudentDashboardItem(node.item)),
    nextCursor: nextCursorFromNodes(input),
  };
}

const readSectionByUiSection = {
  open: "open",
  scheduled: "scheduled",
  "needs-attention": "needs_attention",
  "deadline-closed": "deadline_closed",
} as const;

function currentAssignmentFromNode(
  node: z.infer<typeof studentDashboardInitialRowSchema>["current_items"][number],
  snapshotAt: string,
) {
  const assignment = mapStudentDashboardItem(node.item);
  const derivedSection = selectStudentAssignmentSections(
    [assignment],
    Date.parse(snapshotAt),
  ).find((section) => section.assignments.length > 0)?.id;
  if (
    !derivedSection ||
    derivedSection === "completed" ||
    readSectionByUiSection[derivedSection] !== node.dashboardSection
  ) {
    throw new StudentDashboardReadError(
      "학생 시험 상태 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  return { assignment, section: node.dashboardSection };
}

export async function getStudentDashboardInitial(
  student: Pick<StudentSession, "studentId">,
): Promise<StudentDashboardInitialSnapshot> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_student_dashboard_initial_v1",
    {
      p_snapshot_at: null,
      p_student_id: student.studentId,
    },
  );
  if (error) {
    throw new StudentDashboardReadError(
      "학생 시험 목록을 불러오지 못했습니다.",
    );
  }
  const parsed = z.array(studentDashboardInitialRowSchema).safeParse(data ?? []);
  if (!parsed.success || parsed.data.length !== 1) {
    throw new StudentDashboardReadError(
      "학생 시험 목록 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const row = parsed.data[0];
  const currentCounts = {
    deadline_closed: row.deadline_closed_count,
    needs_attention: row.needs_attention_count,
    open: row.open_count,
    scheduled: row.scheduled_count,
  };
  for (const section of Object.keys(currentCounts) as Array<
    keyof typeof currentCounts
  >) {
    if (
      row.current_items.filter((node) => node.dashboardSection === section)
        .length !== currentCounts[section]
    ) {
      throw new StudentDashboardReadError(
        "학생 시험 구역 개수를 확인하지 못했습니다.",
        "contract",
      );
    }
  }
  if (row.completed_count < Math.min(row.completed_items.length, PAGE_SIZE)) {
    throw new StudentDashboardReadError(
      "완료 시험 개수를 확인하지 못했습니다.",
      "contract",
    );
  }
  return {
    completedPage: completedPageFromNodes({
      nodes: row.completed_items,
      snapshotAt: row.snapshot_at,
      studentId: student.studentId,
    }),
    currentAssignments: row.current_items.map((node) =>
      currentAssignmentFromNode(node, row.snapshot_at)
    ),
    sectionCounts: {
      completed: row.completed_count,
      deadline_closed: row.deadline_closed_count,
      needs_attention: row.needs_attention_count,
      open: row.open_count,
      scheduled: row.scheduled_count,
    },
    snapshotAt: row.snapshot_at,
  };
}

export async function getStudentDashboardCompletedPage(
  cursorValue: string,
  student: Pick<StudentSession, "studentId">,
): Promise<StudentDashboardCompletedPage> {
  const cursor = decodeStudentDashboardCursor(cursorValue);
  assertStudentDashboardCursorOwner(cursor, student.studentId);
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_dashboard_completed_page_v1",
    {
      p_cursor_assignment_id: cursor.assignmentId,
      p_cursor_effective_at: cursor.effectiveAt,
      p_snapshot_at: cursor.snapshotAt,
      p_student_id: student.studentId,
    },
  );
  if (error) {
    throw new StudentDashboardReadError(
      "다음 완료 시험을 불러오지 못했습니다.",
    );
  }
  const parsed = z
    .array(studentDashboardCompletedPageRowSchema)
    .max(DATABASE_PAGE_LIMIT)
    .safeParse(data ?? []);
  if (!parsed.success) {
    throw new StudentDashboardReadError(
      "다음 완료 시험 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const nodes: StudentDashboardCompletedNode[] = parsed.data.map((row) => ({
    assignmentId: row.cursor_assignment_id,
    effectiveAt: row.cursor_effective_at,
    item: row.item,
  }));
  return completedPageFromNodes({
    nodes,
    snapshotAt: cursor.snapshotAt,
    studentId: student.studentId,
  });
}
