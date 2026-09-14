import "server-only";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export type CompositionLineage = { sourceEntryId: number; sourceReleaseId: string; compositionReleaseId: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function readCompositionLineage(entryIds: readonly number[]): Promise<Map<number, CompositionLineage>> {
  const ids = [...new Set(entryIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  const result = new Map<number, CompositionLineage>();
  if (!ids.length) return result;
  try {
    const supabase = getServiceSupabaseClient();
    for (let offset = 0; offset < ids.length; offset += 400) {
      const chunk = ids.slice(offset, offset + 400);
      const { data, error } = await supabase.rpc("list_mock_composition_lineage_v1", { p_entry_ids: chunk });
      if (error || !Array.isArray(data) || data.length > chunk.length) throw new Error("lineage_unavailable");
      for (const row of data) {
        if (!row || !chunk.includes(row.vocab_entry_id) || result.has(row.vocab_entry_id) ||
          !Number.isSafeInteger(row.source_entry_id) || row.source_entry_id <= 0 || row.source_entry_id === row.vocab_entry_id ||
          typeof row.source_release_id !== "string" || !uuid.test(row.source_release_id) ||
          typeof row.composition_release_id !== "string" || !uuid.test(row.composition_release_id)) throw new Error("lineage_invalid");
        result.set(row.vocab_entry_id, { sourceEntryId: row.source_entry_id, sourceReleaseId: row.source_release_id, compositionReleaseId: row.composition_release_id });
      }
    }
    return result;
  } catch {
    // A successful empty result means an ordinary book. Failed proof lookup
    // must not silently drop source audio or substitute an older snapshot.
    throw new Error("단어장의 학습정보 연결을 확인하지 못했습니다. 다시 시도해 주세요.");
  }
}

export async function readMappedEntryResources<T>(entryIds: readonly number[], readOriginal: (ids: readonly number[]) => Promise<Map<number,T>>,
  mapValue: (value: T, targetId: number) => T = value => value) {
  const ids = [...new Set(entryIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return new Map<number,T>();
  const lineage = await readCompositionLineage(ids);
  const sourceIds = [...new Set(ids.map(id => lineage.get(id)?.sourceEntryId ?? id))];
  const resources = await readOriginal(sourceIds);
  const result = new Map<number,T>();
  for (const id of ids) {
    const value = resources.get(lineage.get(id)?.sourceEntryId ?? id);
    if (value !== undefined) result.set(id, mapValue(value, id));
  }
  return result;
}
