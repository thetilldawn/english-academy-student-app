import { Buffer } from "node:buffer";
import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const base64Key = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "32바이트 base64 키가 필요합니다." },
);

const serverEnvironmentSchema = publicEnvironmentSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(20),
  STUDENT_CODE_PEPPER: base64Key,
  STUDENT_SESSION_PEPPER: base64Key,
  STUDENT_CODE_ENCRYPTION_KEY: base64Key,
  LOGIN_IP_PEPPER: base64Key,
  APP_ORIGIN: z.url().optional(),
});

export class AppConfigurationError extends Error {
  constructor(message = "앱 환경변수 설정이 완료되지 않았습니다.") {
    super(message);
    this.name = "AppConfigurationError";
  }
}

export function hasSupabaseEnvironment(): boolean {
  return publicEnvironmentSchema.safeParse(process.env).success;
}

export function getPublicEnvironment() {
  const result = publicEnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    throw new AppConfigurationError();
  }

  return result.data;
}

export function getServerEnvironment() {
  const result = serverEnvironmentSchema.safeParse(process.env);

  if (
    !result.success ||
    (process.env.NODE_ENV === "production" && !result.data.APP_ORIGIN)
  ) {
    throw new AppConfigurationError(
      result.success
        ? "운영환경에는 APP_ORIGIN이 필요합니다."
        : `서버 환경변수 설정이 올바르지 않습니다: ${result.error.issues
            .map((issue) => issue.path.join("."))
            .join(", ")}`,
    );
  }

  return result.data;
}
