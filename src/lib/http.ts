import { z } from "zod";

export function jsonError(
  message: string,
  status: number,
  details: { code?: string; fieldPath?: string } = {},
) {
  return Response.json({ error: message, ...details }, { status });
}

export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | null> {
  try {
    const body: unknown = await request.json();
    const result = schema.safeParse(body);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const expectedOrigin = process.env.APP_ORIGIN ?? requestUrl.origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (origin) {
    return origin === expectedOrigin;
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return (
    fetchSite === null ||
    fetchSite === "same-origin" ||
    fetchSite === "same-site"
  );
}

export function getClientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedParts = forwarded
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    request.headers.get("x-real-ip")?.trim() ||
    forwardedParts?.at(-1) ||
    "unknown"
  );
}
