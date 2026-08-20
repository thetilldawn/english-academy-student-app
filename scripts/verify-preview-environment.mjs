const PREVIEW_ENVIRONMENT = "preview";
const PRODUCTION_ENVIRONMENT = "production";
const PRODUCTION_SUPABASE_PROJECT_REF = "xdxhswjgksukjmpbzqgz";

export function getSupabaseProjectRef(value) {
  try {
    const url = new URL(value);
    const [projectRef, ...rest] = url.hostname.split(".");
    if (
      !projectRef ||
      rest.join(".") !== "supabase.co" ||
      !/^[a-z0-9]{20}$/.test(projectRef)
    ) {
      return null;
    }
    return projectRef;
  } catch {
    return null;
  }
}

export function assertPreviewEnvironment(environment = process.env) {
  if (environment.VERCEL_ENV === PRODUCTION_ENVIRONMENT) {
    const actualRef = getSupabaseProjectRef(
      environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
    );
    if (actualRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
      throw new Error(
        `Production build blocked: Supabase ref mismatch (expected ${PRODUCTION_SUPABASE_PROJECT_REF}, received ${actualRef ?? "invalid URL"}).`,
      );
    }
    return;
  }
  if (environment.VERCEL_ENV !== PREVIEW_ENVIRONMENT) {
    return;
  }

  const expectedRef = environment.PREVIEW_EXPECTED_SUPABASE_PROJECT_REF;
  const actualRef = getSupabaseProjectRef(
    environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
  );

  if (!expectedRef || !/^[a-z0-9]{20}$/.test(expectedRef)) {
    throw new Error(
      "Preview build blocked: PREVIEW_EXPECTED_SUPABASE_PROJECT_REF is missing or invalid.",
    );
  }
  if (
    expectedRef === PRODUCTION_SUPABASE_PROJECT_REF ||
    actualRef === PRODUCTION_SUPABASE_PROJECT_REF
  ) {
    throw new Error(
      "Preview build blocked: the Production Supabase project is not allowed.",
    );
  }
  if (actualRef !== expectedRef) {
    throw new Error(
      `Preview build blocked: Supabase ref mismatch (expected ${expectedRef}, received ${actualRef ?? "invalid URL"}).`,
    );
  }

  if (environment.GOOGLE_DRIVE_ENABLED === "true") {
    const actualDriveFolder =
      environment.GOOGLE_DRIVE_STUDENT_ROOT_FOLDER_ID;
    const expectedDriveFolder =
      environment.PREVIEW_EXPECTED_GOOGLE_DRIVE_FOLDER_ID;
    if (!expectedDriveFolder || actualDriveFolder !== expectedDriveFolder) {
      throw new Error(
        "Preview build blocked: Google Drive student folder is not the approved Preview folder.",
      );
    }
  }
}

assertPreviewEnvironment();
