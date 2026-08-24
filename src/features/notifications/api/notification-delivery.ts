import { z } from "zod";

const responseSchema = z.object({
  newAssignmentCount: z.number().int().nonnegative(),
  deadlineSoonCount: z.number().int().nonnegative(),
});

export type NotificationDelivery = z.infer<typeof responseSchema>;

export async function requestNotificationDelivery(
  role: "student" | "admin",
): Promise<NotificationDelivery | null> {
  const response = await fetch(`/api/${role}/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const payload: unknown = await response.json();
  if (!response.ok) return null;
  const parsed = responseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
