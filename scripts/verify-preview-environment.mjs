const PREVIEW_ENVIRONMENT = "preview";

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
  if (actualRef !== expectedRef) {
    throw new Error(
      `Preview build blocked: Supabase ref mismatch (expected ${expectedRef}, received ${actualRef ?? "invalid URL"}).`,
    );
  }
}

assertPreviewEnvironment();
