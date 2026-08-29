"use client";

/** Leaves the current document so an approved discard cannot survive in a parallel route. */
export function navigateDocument(href: string, replace: boolean) {
  if (replace) {
    window.location.replace(href);
    return;
  }
  window.location.assign(href);
}
