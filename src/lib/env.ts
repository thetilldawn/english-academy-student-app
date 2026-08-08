import { Buffer } from "node:buffer";
import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const base64Key = z.string().refine(
  (value) => {
    try {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
        return false;
      }

      const decoded = Buffer.from(value, "base64");
      return (
        decoded.length === 32 &&
        decoded.toString("base64") === value
      );
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

const serviceEnvironmentSchema = publicEnvironmentSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(20),
});

const studentCodeEnvironmentSchema = z.object({
  STUDENT_CODE_PEPPER: base64Key,
  STUDENT_CODE_ENCRYPTION_KEY: base64Key,
});

const studentLoginEnvironmentSchema = z.object({
  STUDENT_CODE_PEPPER: base64Key,
  LOGIN_IP_PEPPER: base64Key,
});

const studentSessionEnvironmentSchema = z.object({
  STUDENT_SESSION_PEPPER: base64Key,
});

const googleDriveEnvironmentSchema = z.object({
  GOOGLE_DRIVE_ENABLED: z.literal("true"),
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: z.string().min(20),
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: z.string().min(10),
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: z.string().min(20),
  GOOGLE_DRIVE_STUDENT_ROOT_FOLDER_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{10,200}$/),
  PREVIEW_EXPECTED_GOOGLE_DRIVE_FOLDER_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{10,200}$/)
    .optional(),
});

export class AppConfigurationError extends Error {
  constructor(message = "앱 환경변수 설정이 완료되지 않았습니다.") {
    super(message);
    this.name = "AppConfigurationError";
  }
}

function parseEnvironment<T extends z.ZodType>(
  schema: T,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    throw new AppConfigurationError(
      `${label} 설정이 올바르지 않습니다: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  return result.data;
}

export function hasSupabaseEnvironment(): boolean {
  return publicEnvironmentSchema.safeParse(process.env).success;
}

export function getPublicEnvironment() {
  return parseEnvironment(publicEnvironmentSchema, "공개 데이터 연결");
}

export function getServiceEnvironment() {
  return parseEnvironment(serviceEnvironmentSchema, "서버 데이터 연결");
}

export function getStudentCodeEnvironment() {
  return parseEnvironment(studentCodeEnvironmentSchema, "학생코드 보안");
}

export function getStudentLoginEnvironment() {
  return parseEnvironment(studentLoginEnvironmentSchema, "학생 인증 보안");
}

export function getStudentSessionEnvironment() {
  return parseEnvironment(studentSessionEnvironmentSchema, "학생 세션 보안");
}

export function getGoogleDriveEnvironment() {
  if (process.env.GOOGLE_DRIVE_ENABLED !== "true") {
    return null;
  }
  const environment = parseEnvironment(
    googleDriveEnvironmentSchema,
    "학생 해석 시험지 Drive 연결",
  );
  if (
    process.env.VERCEL_ENV === "preview" &&
    environment.PREVIEW_EXPECTED_GOOGLE_DRIVE_FOLDER_ID !==
      environment.GOOGLE_DRIVE_STUDENT_ROOT_FOLDER_ID
  ) {
    throw new AppConfigurationError(
      "Preview의 학생기록 Drive 폴더가 안전하게 분리되지 않았습니다.",
    );
  }
  return environment;
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
