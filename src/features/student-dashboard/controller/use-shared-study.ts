"use client";
import { useEffect, useRef, useState } from "react";
import { cacheLocalQuizContents, knownLocalQuizContentKeys, readLocalDisplayAtoms, requestLocalQuiz } from "@/features/quiz-player/public-local-client";
import { studentIdentityGeneration, subscribeStudentPrivateCacheChanges } from "@/features/session/public-client";
import { studyMaterialsSchema, type StudyManifest } from "../contracts/study-materials";
import type { AssignmentStudy } from "../contracts/assignment-study";
import { studyAtomKeys, unpackAssignmentStudy } from "../domain/study-materials";

export function useSharedStudy(initial: StudyManifest) {
  const [study, setStudy] = useState<AssignmentStudy | null>(null); const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [blockedIdentity, setBlockedIdentity] = useState(false);
  const authenticatedGeneration = useRef<string | null>(null);
  useEffect(() => {
    let alive = true; const abort = new AbortController();
    const stop = subscribeStudentPrivateCacheChanges(kind => {
      if (kind !== "identity") return; alive = false; abort.abort(); setStudy(null); setBlockedIdentity(true); setError("학생 계정이 바뀌었습니다. 목록에서 다시 열어 주세요.");
    });
    (async () => {
      try {
        const identity = studentIdentityGeneration();
        authenticatedGeneration.current ??= identity;
        if (identity !== authenticatedGeneration.current) {
          setStudy(null); setBlockedIdentity(true); setError("학생 계정이 바뀌었습니다. 목록에서 다시 열어 주세요."); return;
        }
        let manifest = initial; let atoms = await readLocalDisplayAtoms(studyAtomKeys(manifest));
        if (atoms.size !== studyAtomKeys(manifest).length) {
          const response = studyMaterialsSchema.parse(await requestLocalQuiz({ action: "study", assignmentId: manifest.assignmentId, knownKeys: await knownLocalQuizContentKeys() }, abort.signal));
          if (!alive || identity !== studentIdentityGeneration()) return;
          manifest = response.manifest; await cacheLocalQuizContents({ contents: [], atoms: response.atoms });
          atoms = await readLocalDisplayAtoms(studyAtomKeys(manifest));
        }
        const restored = unpackAssignmentStudy(manifest, atoms);
        if (alive && identity === studentIdentityGeneration()) { setStudy(restored); setError(""); }
      } catch { if (alive) setError("단어 자료를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요."); }
    })();
    return () => { alive = false; abort.abort(); stop(); };
  }, [initial, retry]);
  return { study, error, blockedIdentity, retry: () => {
    try { if (studentIdentityGeneration() !== authenticatedGeneration.current) { window.location.reload(); return; } }
    catch { setStudy(null); setError("학생 계정을 확인하지 못했습니다. 목록에서 다시 열어 주세요."); return; }
    setError(""); setRetry(n => n + 1);
  } };
}
