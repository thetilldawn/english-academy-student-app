"use client";
import { useEffect, useRef, useState } from "react";
import { cacheLocalQuizContents, knownLocalQuizAssignmentKeys, rememberLocalQuizMaterials, readLocalDisplayAtoms, requestLocalQuiz } from "@/features/quiz-player/public-local-client";
import { studentIdentityGeneration, subscribeStudentPrivateCacheChanges } from "@/features/session/public-client";
import { studyResponseSchema, type OpenStudyAccess, type StudyManifest } from "../contracts/study-materials";
import type { AssignmentStudy, LockedAssignmentStudy } from "../contracts/assignment-study";
import { studyAtomKeys, unpackAssignmentStudy } from "../domain/study-materials";

const FRESH_MS = 48 * 60 * 60 * 1000;
// Private assignment references live only in this authenticated page session.
// Shared display atoms retain their existing IndexedDB and 48-hour policy.
const manifests = new Map<string, { manifest: StudyManifest; fetchedAt: number }>();
const accessKey = (access: OpenStudyAccess) => `${access.studentId}:${access.assignmentId}:${access.revision}`;

export function useSharedStudy(initial: OpenStudyAccess) {
  const key = accessKey(initial);
  const [result, setResult] = useState<{ key: string; study: AssignmentStudy } | null>(null);
  const [locked, setLocked] = useState<LockedAssignmentStudy | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [blockedIdentity, setBlockedIdentity] = useState(false);
  const authenticatedGeneration = useRef<string | null>(null);
  useEffect(() => {
    let alive = true; const abort = new AbortController();
    const stop = subscribeStudentPrivateCacheChanges(kind => {
      if (kind !== "identity") return; alive = false; abort.abort(); manifests.clear(); setResult(null); setLocked(null); setBlockedIdentity(true); setError("학생 계정이 바뀌었습니다. 목록에서 다시 열어 주세요.");
    });
    (async () => {
      try {
        const identity = studentIdentityGeneration();
        authenticatedGeneration.current ??= identity;
        if (identity !== authenticatedGeneration.current) {
          setResult(null); setLocked(null); setBlockedIdentity(true); setError("학생 계정이 바뀌었습니다. 목록에서 다시 열어 주세요."); return;
        }
        const cacheKey = `${identity}:${key}`;
        const cached = manifests.get(cacheKey);
        const age = cached ? Date.now() - cached.fetchedAt : Infinity;
        const fresh = cached && age >= 0 && age < FRESH_MS;
        let manifest = fresh ? cached.manifest : null;
        let atoms = manifest ? await readLocalDisplayAtoms(studyAtomKeys(manifest)) : new Map();
        if (!manifest || atoms.size !== studyAtomKeys(manifest).length) {
          const response = studyResponseSchema.parse(await requestLocalQuiz({ action: "study", assignmentId: initial.assignmentId, knownKeys: await knownLocalQuizAssignmentKeys(identity, initial.assignmentId) }, abort.signal));
          if (!alive || identity !== studentIdentityGeneration()) return;
          if ("locked" in response) { manifests.delete(cacheKey); setResult(null); setLocked(response.locked); return; }
          if (response.access.studentId !== initial.studentId || response.access.assignmentId !== initial.assignmentId || response.manifest.assignmentId !== initial.assignmentId) throw new Error("study_identity_mismatch");
          manifest = response.manifest; await cacheLocalQuizContents({ contents: [], atoms: response.atoms });
          atoms = await readLocalDisplayAtoms(studyAtomKeys(manifest));
          unpackAssignmentStudy(manifest, atoms);
          if (!alive || identity !== studentIdentityGeneration()) return;
          if (manifests.size >= 64) manifests.delete(manifests.keys().next().value!);
          manifests.set(`${identity}:${accessKey(response.access)}`, { manifest, fetchedAt: Date.now() });
        }
        const restored = unpackAssignmentStudy(manifest, atoms);
        if (!alive || identity !== studentIdentityGeneration()) return;
        await rememberLocalQuizMaterials(identity, initial.assignmentId, studyAtomKeys(manifest));
        if (alive && identity === studentIdentityGeneration()) { setResult({ key, study: restored }); setLocked(null); setError(""); }
      } catch { if (alive) setError("단어 자료를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요."); }
    })();
    return () => { alive = false; abort.abort(); stop(); };
  }, [initial, key, retry]);
  return { study: result?.key === key ? result.study : null, locked, error, blockedIdentity, retry: () => {
    try { if (studentIdentityGeneration() !== authenticatedGeneration.current) { window.location.reload(); return; } }
    catch { setResult(null); setError("학생 계정을 확인하지 못했습니다. 목록에서 다시 열어 주세요."); return; }
    setError(""); setRetry(n => n + 1);
  } };
}
