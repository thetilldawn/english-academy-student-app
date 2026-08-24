import "server-only";

import { requireAdmin } from "@/lib/auth/admin";
import type { AssignmentSummary } from "@/lib/admin/assignment-summary";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { loadDatasetDisplayLabelMap } from "./dataset-catalog-service";

export async function listAssignments(): Promise<AssignmentSummary[]> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const [
    { data, error },
    { data: assignmentStudentData, error: studentLinkError },
    { data: assignmentUnitData, error: unitLinkError },
    { data: unitData, error: unitError },
    { data: datasetData, error: datasetError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, title, status, dataset_id, range_start, range_end, question_count, english_to_korean_ratio, time_limit_seconds, passing_score, question_order_mode, available_until, created_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("assignment_students").select("assignment_id"),
    supabase
      .from("assignment_units")
      .select("assignment_id, unit_id, position")
      .order("position"),
    supabase.from("vocab_units").select("id, unit_label"),
    supabase.from("vocab_datasets").select("id, title, edition"),
  ]);

  if (
    error ||
    studentLinkError ||
    unitLinkError ||
    unitError ||
    datasetError
  ) {
    throw new Error("시험 배정 목록을 불러오지 못했습니다.");
  }

  const studentCounts = new Map<string, number>();
  for (const row of assignmentStudentData ?? []) {
    studentCounts.set(
      row.assignment_id,
      (studentCounts.get(row.assignment_id) ?? 0) + 1,
    );
  }
  const unitLabelById = new Map(
    (unitData ?? []).map((unit) => [unit.id, unit.unit_label]),
  );
  const unitLabelsByAssignment = new Map<string, string[]>();
  for (const link of assignmentUnitData ?? []) {
    const labels = unitLabelsByAssignment.get(link.assignment_id) ?? [];
    const label = unitLabelById.get(link.unit_id);
    if (label) labels.push(label);
    unitLabelsByAssignment.set(link.assignment_id, labels);
  }
  const datasetTitleById = await loadDatasetDisplayLabelMap(
    supabase,
    datasetData ?? [],
  );

  return (data ?? []).map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    status: assignment.status,
    datasetId: assignment.dataset_id,
    datasetTitle:
      datasetTitleById.get(assignment.dataset_id) ?? "단어장",
    unitLabels: unitLabelsByAssignment.get(assignment.id) ?? [],
    rangeStart: assignment.range_start,
    rangeEnd: assignment.range_end,
    questionCount: assignment.question_count,
    englishToKoreanRatio: assignment.english_to_korean_ratio,
    timeLimitSeconds: assignment.time_limit_seconds,
    passingScore: assignment.passing_score,
    questionOrderMode: assignment.question_order_mode,
    availableUntil: assignment.available_until,
    studentCount: studentCounts.get(assignment.id) ?? 0,
    createdAt: assignment.created_at,
  }));
}
