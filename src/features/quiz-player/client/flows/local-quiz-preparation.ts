import { z } from "zod";
export { prefetchLocalQuiz } from "./local-quiz-prefetch";
import { studentIdentityGeneration } from "@/features/session/public-client";
import { requestLocalQuiz } from "../../api/local-quiz";
import { localQuizPreparationSchema, type LocalQuizRun } from "../../contracts/local-quiz";
import { cacheLocalQuizContents, findLocalQuizRun, getLocalQuizDevice, knownLocalQuizContentKeys,
  readLocalQuizContents, saveLocalQuizRun, pruneLocalQuizContents } from "./local-quiz-store";

export async function prepareLocalQuiz(assignmentId: string) {
  const identity = studentIdentityGeneration(); const device = await getLocalQuizDevice();
  await pruneLocalQuizContents();
  const response = await requestLocalQuiz({ action: "prepare", assignmentId, device, knownKeys: await knownLocalQuizContentKeys() });
  if (studentIdentityGeneration() !== identity) throw new Error("학생 계정이 바뀌었습니다. 다시 열어 주세요.");
  const resume = z.object({ protocol: z.enum(["legacy", "local_batch_v1"]), studentId: z.uuid(), resumeId: z.uuid() }).safeParse(response);
  if (resume.success) {
    if (resume.data.protocol === "legacy") return `/student/attempt/${resume.data.resumeId}`;
    const local = await findLocalQuizRun(resume.data.resumeId, resume.data.studentId);
    if (!local) throw new Error("이 시험은 처음 시작한 기기의 브라우저에서 이어서 진행해 주세요.");
    return `/quiz-offline#${local.key}`;
  }
  let prepared = localQuizPreparationSchema.parse(response);
  await cacheLocalQuizContents(prepared.packet);
  const contents = await readLocalQuizContents(prepared.items.map(i => i.key));
  if (contents.size !== new Set(prepared.items.map(i => i.key)).size) {
    // Never start with a missing/corrupt body. Same preparation receipt, no new clock.
    const repaired = localQuizPreparationSchema.parse(await requestLocalQuiz({ action: "prepare", assignmentId, device, knownKeys: [] }));
    if (repaired.preparationId !== prepared.preparationId || repaired.planHash !== prepared.planHash) throw new Error("시험 준비가 바뀌었습니다. 다시 열어 주세요.");
    await cacheLocalQuizContents(repaired.packet); prepared = repaired;
  }
  const verified = await readLocalQuizContents(prepared.items.map(i => i.key));
  if (verified.size !== new Set(prepared.items.map(i => i.key)).size) throw new Error("시험 자료를 모두 준비하지 못했습니다. 다시 시도해 주세요.");
  if (studentIdentityGeneration() !== identity) throw new Error("학생 계정이 바뀌었습니다. 다시 열어 주세요.");
  const existing = await findLocalQuizRun(prepared.preparationId, prepared.studentId);
  if (existing?.plan || existing?.startRequested) return `/quiz-offline#${existing.key}`;
  const { packet: _packet, ...preparation } = prepared; void _packet;
  const run: LocalQuizRun = { key: prepared.preparationId, revision: existing ? existing.revision + 1 : 0, identity, studentId: prepared.studentId, device, preparation,
    plan: null, startRequested: false, answers: [], openedMs: 0, clock: { wallAt: Date.now(), elapsedAt: 0 }, batch: null, receipt: null };
  await saveLocalQuizRun(run, existing?.revision ?? null);
  return `/quiz-offline#${run.key}`;
}
