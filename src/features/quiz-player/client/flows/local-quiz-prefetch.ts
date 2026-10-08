import { studentIdentityGeneration } from "@/features/session/public-client";
import { z } from "zod";
import { requestLocalQuiz } from "../../api/local-quiz";
import { COMMON_QUIZ_FRESH_MS, commonQuizPacketSchema } from "../../contracts/local-quiz";
import { cacheLocalQuizContents, knownLocalQuizAssignmentKeys, knownLocalQuizKeysFor, rememberLocalQuizMaterials } from "./local-quiz-store";
import { cancelLocalQuizMaintenance } from "./local-quiz-maintenance";

type Task = {
  key: string; assignmentId: string; identity: string; controller: AbortController;
  promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void;
  subscribers: number; settled: boolean;
};
const tasks = new Map<string, Task>();
const completed = new Map<string, { fetchedAt: number; keys: string[] }>();
const prefetchPacket = commonQuizPacketSchema.extend({ requiredKeys: z.array(z.string()).max(5500).default([]) });
const queue: Task[] = [];
let active = 0;
const cancelled = () => new DOMException("Prefetch cancelled", "AbortError");
function drain() {
  while (active < 2 && queue.length) {
    const task = queue.shift()!;
    active++;
    void (async () => {
      const check = () => {
        if (task.controller.signal.aborted || studentIdentityGeneration() !== task.identity) throw cancelled();
      };
      check();
      const previous = completed.get(task.key);
      const age = previous ? Date.now() - previous.fetchedAt : Infinity;
      const knownKeys = previous && age >= 0 && age < COMMON_QUIZ_FRESH_MS ? await knownLocalQuizKeysFor(previous.keys) : await knownLocalQuizAssignmentKeys(task.identity, task.assignmentId);
      check();
      const known = new Set(knownKeys);
      if (previous && age >= 0 && age < COMMON_QUIZ_FRESH_MS && previous.keys.every(key => known.has(key))) return;
      completed.delete(task.key);
      const packet = prefetchPacket.parse(await requestLocalQuiz(
        { action: "prefetch", assignmentId: task.assignmentId, knownKeys, includeRefs: true }, task.controller.signal));
      check();
      await cacheLocalQuizContents({ contents: packet.contents, atoms: packet.atoms });
      check();
      if (packet.requiredKeys.length) {
        await rememberLocalQuizMaterials(task.identity, task.assignmentId, packet.requiredKeys);
        check();
        if (completed.size >= 64) completed.delete(completed.keys().next().value!);
        completed.set(task.key, { fetchedAt: Date.now(), keys: packet.requiredKeys });
      }
    })().then(() => { task.settled = true; task.resolve(); }, error => { task.settled = true; task.reject(error); }).finally(() => {
      if (tasks.get(task.key) === task) tasks.delete(task.key);
      active--;
      drain();
    });
  }
}
/** At most two reads and six queued reads across every assignment card. */
export async function prefetchLocalQuiz(assignmentId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled());
  cancelLocalQuizMaintenance();
  const identity = studentIdentityGeneration(); const key = identity + ":" + assignmentId;
  let task = tasks.get(key);
  if (!task || task.controller.signal.aborted) {
    if (active + queue.length >= 8) return Promise.reject(cancelled());
    let resolve!: () => void; let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    task = { key, assignmentId, identity, promise, resolve, reject, controller: new AbortController(), subscribers: 0, settled: false };
    tasks.set(key, task); queue.push(task);
    queueMicrotask(drain);
  }
  return subscribe(task, signal);
}

/** Join an existing hover read before its button unsubscribes on click. */
export async function joinLocalQuizPrefetch(assignmentId: string, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  const identity = studentIdentityGeneration(), key = identity + ":" + assignmentId;
  const task = tasks.get(key);
  if (task && !task.controller.signal.aborted) {
    const queued = queue.indexOf(task);
    if (queued > 0) { queue.splice(queued, 1); queue.unshift(task); }
    await subscribe(task, signal);
  }
  signal?.throwIfAborted();
  if (studentIdentityGeneration() !== identity) throw cancelled();
  const result = completed.get(key), age = result ? Date.now() - result.fetchedAt : Infinity;
  return result && age >= 0 && age < COMMON_QUIZ_FRESH_MS ? result.keys : [];
}

function subscribe(subscribed: Task, signal?: AbortSignal): Promise<void> {
  subscribed.subscribers++;
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true; signal?.removeEventListener("abort", abort);
      subscribed.subscribers--;
      if (!subscribed.subscribers && !subscribed.settled) {
        subscribed.controller.abort();
        const waiting = queue.indexOf(subscribed);
        if (waiting !== -1) {
          queue.splice(waiting, 1); subscribed.settled = true;
          if (tasks.get(subscribed.key) === subscribed) tasks.delete(subscribed.key);
          subscribed.reject(cancelled());
        }
      }
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    subscribed.promise.then(() => finish(), finish);
    if (signal?.aborted) abort();
  });
}
