import "server-only";

import { z } from "zod";

import { getServiceSupabaseClient } from "@/lib/supabase/service";

const notificationCountsSchema = z.object({
  new_assignment_count: z.coerce.number().int().nonnegative(),
  deadline_soon_count: z.coerce.number().int().nonnegative(),
});

export type NotificationCounts = {
  newAssignmentCount: number;
  deadlineSoonCount: number;
};

async function claimNotifications(
  functionName:
    | "claim_student_notifications_v1"
    | "claim_admin_notifications_v1",
  parameterName: "p_student_id" | "p_admin_id",
  viewerId: string,
): Promise<NotificationCounts> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(functionName, {
    [parameterName]: viewerId,
  });

  const result = notificationCountsSchema.safeParse(
    Array.isArray(data) ? data[0] : data,
  );
  if (error || !result.success) {
    throw new Error("새 알림을 확인하지 못했습니다.");
  }

  return {
    newAssignmentCount: result.data.new_assignment_count,
    deadlineSoonCount: result.data.deadline_soon_count,
  };
}

export function claimStudentNotifications(studentId: string) {
  return claimNotifications(
    "claim_student_notifications_v1",
    "p_student_id",
    studentId,
  );
}

export function claimAdminNotifications(adminId: string) {
  return claimNotifications(
    "claim_admin_notifications_v1",
    "p_admin_id",
    adminId,
  );
}
