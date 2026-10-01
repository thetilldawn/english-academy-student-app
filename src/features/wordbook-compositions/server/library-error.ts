import "server-only";

export class LibraryCommandError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 422 | 503, readonly progressConfirmed = false, readonly sourceUnavailable = false) { super("library_save_failed"); }
}

export function isVocabularySourceError(error: { code?: string; message?: string }) {
  return (error.code === "40001" || error.code === "22023") && /^vocabulary_[a-z_]+$/.test(error.message ?? "");
}
