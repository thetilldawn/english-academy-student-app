import type { NextRequest } from "next/server";

import { refreshAdminSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return refreshAdminSession(request);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
