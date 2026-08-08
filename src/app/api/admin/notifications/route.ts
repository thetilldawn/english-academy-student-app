import { getAdminContext } from "@/lib/auth/admin";
import { isSameOriginRequest, jsonError } from "@/lib/http";
import { claimAdminNotifications } from "@/lib/services/notification-service";

const privateNoStore = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  const admin = await getAdminContext();
  if (!admin) {
    return jsonError("관리자 인증이 필요합니다.", 401);
  }

  try {
    const counts = await claimAdminNotifications(admin.userId);
    return Response.json(counts, { headers: privateNoStore });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "새 알림을 확인하지 못했습니다.",
      },
      { status: 500, headers: privateNoStore },
    );
  }
}
