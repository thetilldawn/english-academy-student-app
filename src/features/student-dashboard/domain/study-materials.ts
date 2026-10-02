import { canonicalDisplayJson, displayDigest, makeDisplayAtom, type DisplayAtom } from "@/lib/quiz/shared-display";
import type { AssignmentStudy } from "../contracts/assignment-study";
import type { StudyManifest } from "../contracts/study-materials";

export async function packAssignmentStudy(study: AssignmentStudy, known: readonly string[] = []) {
  const atoms = new Map<string, DisplayAtom>(); const existing = new Set(known);
  const put = async (value: DisplayAtom["value"]) => { const atom = await makeDisplayAtom(value); atoms.set(atom.key, atom); return atom.key; };
  const words = await Promise.all(study.words.map(async word => ({ key: word.key,
    headwordRef: await put({ kind: "text", text: word.headword }), meaningRef: await put({ kind: "text", text: word.meaning }),
    pronunciationRef: await put({ kind: "pronunciation", pronunciation: { ...word.pronunciation, segments: word.pronunciation.segments ? [...word.pronunciation.segments] : undefined } }),
    definitionRef: word.definition === null ? null : await put({ kind: "text", text: word.definition }),
    exampleRef: word.example === null ? null : await put({ kind: "text", text: word.example }), exampleRanges: word.exampleRanges ?? null,
  })));
  const body = { assignmentId: study.assignmentId, title: study.title, mode: study.mode, words };
  return { manifest: { ...body, manifestHash: await displayDigest(canonicalDisplayJson(body)) }, atoms: [...atoms.values()].filter(a => !existing.has(a.key)) };
}
export function studyAtomKeys(manifest: StudyManifest) {
  return [...new Set(manifest.words.flatMap(w => [w.headwordRef, w.meaningRef, w.pronunciationRef, w.definitionRef, w.exampleRef].filter((k): k is string => k !== null)))];
}
export function unpackAssignmentStudy(manifest: StudyManifest, atoms: ReadonlyMap<string, DisplayAtom>): AssignmentStudy {
  const text = (key: string) => { const atom = atoms.get(key)?.value; if (atom?.kind !== "text") throw new Error("study_material_missing"); return atom.text; };
  return { assignmentId: manifest.assignmentId, title: manifest.title, mode: manifest.mode, words: manifest.words.map(w => {
    const pronunciation = atoms.get(w.pronunciationRef)?.value;
    if (pronunciation?.kind !== "pronunciation") throw new Error("study_material_missing");
    return { key: w.key, headword: text(w.headwordRef), meaning: text(w.meaningRef), pronunciation: pronunciation.pronunciation,
      definition: w.definitionRef === null ? null : text(w.definitionRef), example: w.exampleRef === null ? null : text(w.exampleRef), exampleRanges: w.exampleRanges };
  }) };
}
