import { z } from "zod";
export { prefetchLocalQuiz } from "./local-quiz-prefetch";
import { joinLocalQuizPrefetch } from "./local-quiz-prefetch";
import { joinSharedRead, type SharedRead } from "@/lib/network/join-shared-read";
import { studentIdentityGeneration } from "@/features/session/public-client";
import { requestLocalQuiz } from "../../api/local-quiz";
import { localQuizPreparationSchema, type LocalQuizRun } from "../../contracts/local-quiz";
import { cacheLocalQuizContents, findLocalQuizRun, getLocalQuizDevice, knownLocalQuizAssignmentKeys, knownLocalQuizKeysFor,
  readLocalQuizContents, saveLocalQuizRun } from "./local-quiz-store";
import { cancelLocalQuizMaintenance } from "./local-quiz-maintenance";

const preparations = new Map<string, SharedRead<string>>();
export function prepareLocalQuiz(assignmentId: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException("Request cancelled", "AbortError"));
  cancelLocalQuizMaintenance();
  const identity = studentIdentityGeneration(), key = identity + ":" + assignmentId;
  let request = preparations.get(key);
  if (!request || request.abort.signal.aborted) {
    const shared: SharedRead<string> = { abort: new AbortController(), consumers: [], promise: Promise.resolve("") };
    preparations.set(key, shared);
    // Join the existing hover read before the button unsubscribes.
    shared.promise = executePreparation(assignmentId, identity, shared.abort.signal).finally(() => {
      if (preparations.get(key) === shared) preparations.delete(key);
    });
    request = shared;
  }
  return joinSharedRead(request, signal);
}
async function executePreparation(assignmentId: string, identity: string, signal: AbortSignal) {
  const check = () => {
    signal.throwIfAborted();
    if (studentIdentityGeneration() !== identity) throw new Error("학생 계정이 바뀌었습니다. 다시 열어 주세요.");
  };
  check();
  const warmKeys = await joinLocalQuizPrefetch(assignmentId, signal).catch(() => { check(); return []; });
  check();
  const device = await getLocalQuizDevice();
  check();
  const knownKeys = warmKeys.length ? await knownLocalQuizKeysFor(warmKeys) : await knownLocalQuizAssignmentKeys(identity, assignmentId);
  check();
  const response = await requestLocalQuiz({ action: "prepare", assignmentId, device, knownKeys }, signal);
  check();
  const resume = z.object({ protocol: z.enum(["legacy", "local_batch_v1"]), studentId: z.uuid(), resumeId: z.uuid() }).safeParse(response);
  if (resume.success) {
    if (resume.data.protocol === "legacy") return `/student/attempt/${resume.data.resumeId}`;
    const local = await findLocalQuizRun(resume.data.resumeId, resume.data.studentId);
    check();
    if (!local) throw new Error("이 시험은 처음 시작한 기기의 브라우저에서 이어서 진행해 주세요.");
    return `/quiz-offline#${local.key}`;
  }
  let prepared = localQuizPreparationSchema.parse(response);
  if (prepared.assignmentId !== assignmentId) throw new Error("시험 준비가 바뀌었습니다. 다시 열어 주세요.");
  await cacheLocalQuizContents(prepared.packet);
  check();
  let verified = await readLocalQuizContents(prepared.items.map(i => i.key));
  check();
  if (verified.size !== new Set(prepared.items.map(i => i.key)).size) {
    // Never start with a missing/corrupt body. Same preparation receipt, no new clock.
    const repaired = localQuizPreparationSchema.parse(await requestLocalQuiz({ action: "prepare", assignmentId, device, knownKeys: [] }, signal));
    check();
    if (repaired.preparationId !== prepared.preparationId || repaired.planHash !== prepared.planHash ||
      repaired.studentId !== prepared.studentId || repaired.assignmentId !== prepared.assignmentId) throw new Error("시험 준비가 바뀌었습니다. 다시 열어 주세요.");
    await cacheLocalQuizContents(repaired.packet); check(); prepared = repaired;
    verified = await readLocalQuizContents(prepared.items.map(i => i.key));
    check();
  }
  if (verified.size !== new Set(prepared.items.map(i => i.key)).size) throw new Error("시험 자료를 모두 준비하지 못했습니다. 다시 시도해 주세요.");
  const existing = await findLocalQuizRun(prepared.preparationId, prepared.studentId);
  check();
  if (existing?.plan || existing?.startRequested || existing?.batch || existing?.answers.length) return `/quiz-offline#${existing.key}`;
  const { packet: _packet, ...preparation } = prepared; void _packet;
  const run: LocalQuizRun = { key: prepared.preparationId, revision: existing ? existing.revision + 1 : 0, identity, studentId: prepared.studentId, device, preparation,
    plan: null, startRequested: false, answers: [], openedMs: 0, clock: { wallAt: Date.now(), elapsedAt: 0 }, batch: null, receipt: null };
  await saveLocalQuizRun(run, existing?.revision ?? null);
  check();
  return `/quiz-offline#${run.key}`;
}
