import { makeDisplayAtom, type DisplayAtom } from "@/lib/quiz/shared-display";
import { commonQuizBodySchema, type CommonQuizContent, type CommonQuizPacket, type CommonQuizReference } from "../contracts/local-quiz";
import { commonContentKey } from "./local-quiz";

export async function packLocalQuizContents(contents: CommonQuizContent[], known: readonly string[] = []): Promise<CommonQuizPacket> {
  const existing = new Set(known); const atoms = new Map<string, DisplayAtom>();
  const references: CommonQuizReference[] = [];
  for (const content of contents) {
    const put = async (value: DisplayAtom["value"]) => { const atom = await makeDisplayAtom(value); atoms.set(atom.key, atom); return atom.key; };
    const b = content.body;
    const reference: CommonQuizReference = { key: content.key, contentId: b.contentId, quizContentMode: b.quizContentMode, direction: b.direction,
      prompt: await put({ kind: "text", text: b.prompt }), choices: await Promise.all(b.choices.map(text => put({ kind: "text", text }))),
      pronunciation: await put({ kind: "pronunciation", pronunciation: b.pronunciation }),
      choicePronunciations: await Promise.all(b.choicePronunciations.map(pronunciation => put({ kind: "pronunciation", pronunciation }))) };
    if (!existing.has(content.key)) references.push(reference);
  }
  return { contents: references, atoms: [...atoms.values()].filter(a => !existing.has(a.key)) };
}
export async function unpackLocalQuizContent(reference: CommonQuizReference, atoms: ReadonlyMap<string, DisplayAtom>): Promise<CommonQuizContent | null> {
  const text = (key: string) => { const v = atoms.get(key)?.value; return v?.kind === "text" ? v.text : undefined; };
  const pronunciation = (key: string) => { const v = atoms.get(key)?.value; return v?.kind === "pronunciation" ? v.pronunciation : undefined; };
  const body = commonQuizBodySchema.safeParse({ contentId: reference.contentId, quizContentMode: reference.quizContentMode, direction: reference.direction,
    prompt: text(reference.prompt), choices: reference.choices.map(text), pronunciation: pronunciation(reference.pronunciation),
    choicePronunciations: reference.choicePronunciations.map(pronunciation) });
  return body.success && await commonContentKey(body.data) === reference.key ? { key: reference.key, body: body.data } : null;
}
export function localContentAtomKeys(content: CommonQuizReference) {
  return [content.prompt, ...content.choices, content.pronunciation, ...content.choicePronunciations];
}
