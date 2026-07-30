import { STUDENT_SESSION_MAX_AGE_SECONDS } from "@/lib/constants";

export function adminAuthCookieOptions() {
  return {
    httpOnly: true,
    maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
