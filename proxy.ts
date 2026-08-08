import type { NextRequest } from "next/server";

import { refreshAdminSession } from "@/lib/supabase/proxy";
import { refreshStudentSession } from "@/lib/auth/student-session-proxy";

export async function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/admin")
    ? refreshAdminSession(request)
    : refreshStudentSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/student/:path*",
    "/api/student/:path*",
  ],
};
