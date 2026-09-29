/** In-memory PostgREST read builder. Resolves only after order/range are known. */
export function paginatedRpc<Row extends Record<string, unknown>>(
  read: () => Promise<{ data: Row[]; error: unknown }> | { data: Row[]; error: unknown },
  cap = 1000,
) {
  const columns: string[] = [];
  let from = 0, to = Number.MAX_SAFE_INTEGER;
  async function execute() {
    const result = await read();
    const rows = [...result.data].sort((a, b) => {
      for (const column of columns) {
        const left = a[column], right = b[column];
        if (left === right) continue;
        if (typeof left === "number" && typeof right === "number") return left - right;
        return String(left) < String(right) ? -1 : 1;
      }
      return 0;
    });
    return { ...result, data: rows.slice(from, Math.min(to + 1, from + cap)) };
  }
  const chain = {
    order(column: string) { columns.push(column); return chain; },
    range(start: number, end: number) { from = start; to = end; return chain; },
    then<TResult1 = Awaited<ReturnType<typeof execute>>, TResult2 = never>(
      fulfilled?: ((value: Awaited<ReturnType<typeof execute>>) => TResult1 | PromiseLike<TResult1>) | null,
      rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> { return execute().then(fulfilled, rejected); },
  };
  return chain;
}
