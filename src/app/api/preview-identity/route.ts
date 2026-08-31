function supabaseProjectRef(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const [projectRef, ...hostParts] = url.hostname.split(".");
    return hostParts.join(".") === "supabase.co" ? projectRef : null;
  } catch {
    return null;
  }
}

const noStoreHeaders = { "Cache-Control": "private, no-store" } as const;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new Response(null, { status: 404, headers: noStoreHeaders });
  }
  const deploymentHost = process.env.VERCEL_URL ?? null;
  const gitCommitRef = process.env.VERCEL_GIT_COMMIT_REF ?? null;
  const gitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const projectRef = supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!deploymentHost || !gitCommitRef || !gitCommitSha || !projectRef) {
    return new Response(null, { status: 503, headers: noStoreHeaders });
  }
  return Response.json(
    {
      deploymentHost,
      gitCommitRef,
      gitCommitSha,
      supabaseProjectRef: projectRef,
      vercelEnvironment: "preview",
    },
    { headers: noStoreHeaders },
  );
}
