import { studentIdentityGeneration } from "@/features/session/public-client";
import { z } from "zod";
import { requestLocalQuiz } from "../../api/local-quiz";
import { COMMON_QUIZ_FRESH_MS, commonQuizPacketSchema } from "../../contracts/local-quiz";
import { cacheLocalQuizContents, knownLocalQuizContentKeys } from "./local-quiz-store";

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
      const knownKeys = await knownLocalQuizContentKeys();
      check();
      const previous = completed.get(task.key);
      const age = previous ? Date.now() - previous.fetchedAt : Infinity;
      const known = new Set(knownKeys);
      if (previous && age >= 0 && age < COMMON_QUIZ_FRESH_MS && previous.keys.every(key => known.has(key))) return;
      completed.delete(task.key);
      const packet = prefetchPacket.parse(await requestLocalQuiz(
        { action: "prefetch", assignmentId: task.assignmentId, knownKeys, includeRefs: true }, task.controller.signal));
      check();
      await cacheLocalQuizContents({ contents: packet.contents, atoms: packet.atoms });
      check();
      if (packet.requiredKeys.length) {
        if (completed.size >= 64) completed.delete(completed.keys().next().value!);
        completed.set(task.key, { fetchedAt: Date.now(), keys: packet.requiredKeys });
      }
    })().then(task.resolve, task.reject).finally(() => {
      task.settled = true;
      if (tasks.get(task.key) === task) tasks.delete(task.key);
      active--;
      drain();
    });
  }
}
/** At most two reads and six queued reads across every assignment card. */
export async function prefetchLocalQuiz(assignmentId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled());
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
  const subscribed = task;
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
