import "server-only";

import { z } from "zod";

import type {
  StudentDashboardCompletedPage,
  StudentDashboardInitialSnapshot,
  StudentDashboardCurrentSectionKey,
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
import { decodeStudentDashboardSectionCursor, encodeStudentDashboardSectionCursor } from "../student-dashboard-section-cursor";
import {
  type StudentDashboardCompletedNode,
  mapStudentDashboardItem,
  studentDashboardCompletedPageRowSchema,
  studentDashboardInitialRowSchema,
  studentDashboardCurrentNodeSchema,
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
    "get_student_dashboard_initial_v3",
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
        .length !== Math.min(currentCounts[section], DATABASE_PAGE_LIMIT)
    ) {
      throw new StudentDashboardReadError(
        "학생 시험 구역 개수를 확인하지 못했습니다.",
        "contract",
      );
    }
  }
  if (row.completed_items.length !== Math.min(row.completed_count, DATABASE_PAGE_LIMIT)) {
    throw new StudentDashboardReadError(
      "완료 시험 개수를 확인하지 못했습니다.",
      "contract",
    );
  }
  return {
    currentCursors: Object.fromEntries(Object.keys(currentCounts).map((section) => [section,
      currentPageFromNodes(row.current_items.filter((node) => node.dashboardSection === section),
        row.snapshot_at, student.studentId).nextCursor,
    ])) as Record<StudentDashboardCurrentSectionKey, string | null>,
    completedPage: completedPageFromNodes({
      nodes: row.completed_items,
      snapshotAt: row.snapshot_at,
      studentId: student.studentId,
    }),
    currentAssignments: Object.keys(currentCounts).flatMap((section) => row.current_items
      .filter((node) => node.dashboardSection === section).slice(0, PAGE_SIZE)
      .map((node) => currentAssignmentFromNode(node, row.snapshot_at))),
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

function currentPageFromNodes(nodes: z.infer<typeof studentDashboardCurrentNodeSchema>[], snapshotAt: string, studentId: string): StudentDashboardCompletedPage {
  const last = nodes[PAGE_SIZE - 1];
  return {
    items: nodes.slice(0, PAGE_SIZE).map((node) => currentAssignmentFromNode(node, snapshotAt).assignment),
    nextCursor: nodes.length > PAGE_SIZE && last ? encodeStudentDashboardSectionCursor({
      version: 3, section: last.dashboardSection, assignmentId: last.assignmentId,
      effectiveAt: last.effectiveAt, sortBucket: last.sortBucket, sortAt: last.sortAt,
      secondarySortAt: last.secondarySortAt, snapshotAt,
      studentFingerprint: studentDashboardStudentFingerprint(studentId),
    }) : null,
  };
}

export async function getStudentDashboardSectionPage(cursorValue: string, student: Pick<StudentSession,"studentId">): Promise<StudentDashboardCompletedPage> {
  const cursor = decodeStudentDashboardSectionCursor(cursorValue, student.studentId);
  const { data, error } = await getServiceSupabaseClient().rpc("list_student_dashboard_section_page_v3", {
    p_student_id: student.studentId, p_snapshot_at: cursor.snapshotAt, p_section: cursor.section,
    p_cursor_bucket: cursor.sortBucket, p_cursor_sort_at: cursor.sortAt,
    p_cursor_secondary_sort_at: cursor.secondarySortAt, p_cursor_effective_at: cursor.effectiveAt,
    p_cursor_assignment_id: cursor.assignmentId,
  });
  if (error) throw new StudentDashboardReadError("다음 시험 목록을 불러오지 못했습니다.");
  const parsed = z.array(z.object({
    assignment_id: z.uuid(), effective_at: z.string(), dashboard_section: z.literal(cursor.section),
    item: z.unknown(), sort_bucket: z.number(), sort_at: z.string(), secondary_sort_at: z.string(),
  }).transform((row) => ({ assignmentId: row.assignment_id, effectiveAt: row.effective_at,
    dashboardSection: row.dashboard_section, item: row.item, sortBucket: row.sort_bucket,
    sortAt: row.sort_at, secondarySortAt: row.secondary_sort_at,
  })).pipe(studentDashboardCurrentNodeSchema)).max(DATABASE_PAGE_LIMIT).safeParse(data);
  if (!parsed.success) throw new StudentDashboardReadError("다음 시험 목록 응답을 확인하지 못했습니다.", "contract");
  return currentPageFromNodes(parsed.data, cursor.snapshotAt, student.studentId);
}

export async function getStudentDashboardCompletedPage(
  cursorValue: string,
  student: Pick<StudentSession, "studentId">,
): Promise<StudentDashboardCompletedPage> {
  const cursor = decodeStudentDashboardCursor(cursorValue);
  assertStudentDashboardCursorOwner(cursor, student.studentId);
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_dashboard_completed_page_v2",
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
    .safeParse(data);
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
