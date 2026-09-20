import "server-only";

/** Only validated administrator DTOs reach this writer. Large year selections
 * and older versions use streaming JSON without changing the client contract. */
export function libraryJsonResponse(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 65_536, bytes.length);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
    cancel() { offset = bytes.length; },
  }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
