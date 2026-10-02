import { z } from "zod";
// Display-only sharing. Equal text is never an identity for a word or a mistake.
export const sharedPronunciationSchema = z.object({ displayKo: z.string().nullable(), variantId: z.string().nullable(), audioUrl: z.string().nullable(), available: z.boolean(),
  segments: z.array(z.object({ text: z.string(), stress: z.enum(["none", "secondary", "primary"]) })).optional() }).strict();
export const displayAtomValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ kind: z.literal("pronunciation"), pronunciation: sharedPronunciationSchema }).strict(),
]);
export const displayAtomSchema = z.object({ key: z.string().regex(/^display:v1:[a-f0-9]{64}$/), value: displayAtomValueSchema }).strict();
export type DisplayAtom = z.infer<typeof displayAtomSchema>;
export function canonicalDisplayJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalDisplayJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalDisplayJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function displayDigest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export async function makeDisplayAtom(value: DisplayAtom["value"]): Promise<DisplayAtom> {
  const parsed = displayAtomValueSchema.parse(value);
  return { key: `display:v1:${await displayDigest(canonicalDisplayJson(parsed))}`, value: parsed };
}
