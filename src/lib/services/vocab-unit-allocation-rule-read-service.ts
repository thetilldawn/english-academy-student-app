import "server-only";

import type { AssignmentHistorySource } from "@/lib/admin/history";
import { decodeStoredVocabUnitAllocationRule } from "@/lib/admin/vocab-unit-allocation-rule";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ALLOCATION_RULE_LOOKUP_SIZE = 500;

export async function listAssignmentUnitAllocationRules(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  assignmentIds: readonly string[],
) {
  const result = new Map<string, NonNullable<
    AssignmentHistorySource["vocabUnitAllocation"]
  >>();
  const uniqueIds = [...new Set(assignmentIds)];
  for (let from = 0; from < uniqueIds.length; from += ALLOCATION_RULE_LOOKUP_SIZE) {
    const ids = uniqueIds.slice(from, from + ALLOCATION_RULE_LOOKUP_SIZE);
    if (ids.length === 0) continue;
    const { data, error } = await supabase.rpc(
      "list_vocab_assignment_unit_rules_v1",
      { p_assignment_ids: ids },
    );
    if (error?.code === "42883" || error?.code === "PGRST202") {
      return new Map();
    }
    if (error) {
      throw new Error("최근 시험의 요일별 배정 규칙을 불러오지 못했습니다.");
    }
    for (const row of (data ?? []) as Array<{
      assignment_id: string;
      allocation_rule: unknown;
    }>) {
      const decoded = decodeStoredVocabUnitAllocationRule(row.allocation_rule);
      if (!decoded) {
        console.error("[vocab-unit-allocation-rule] invalid stored rule", {
          assignmentId: row.assignment_id,
        });
        continue;
      }
      result.set(row.assignment_id, decoded);
    }
  }
  return result;
}
