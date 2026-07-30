type ErrorWithDigest = {
  digest?: unknown;
};

const SAFE_DIGEST = /^[A-Za-z0-9_-]{1,128}$/;

export function getErrorReference(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const digest = (error as ErrorWithDigest).digest;
  if (typeof digest !== "string" || !SAFE_DIGEST.test(digest)) {
    return null;
  }

  return `next_${digest}`;
}
