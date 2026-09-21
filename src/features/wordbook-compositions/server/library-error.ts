import "server-only";

export class LibraryCommandError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 422 | 503, readonly progressConfirmed = false) { super("library_save_failed"); }
}
