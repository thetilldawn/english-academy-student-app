"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import type { DialogCloseReason } from "@/design-system/primitives/dialog/dialog";
import { sendKakaoText } from "@/lib/kakao-share";
import { buildStudentAccessUrl } from "@/lib/auth/student-code-input";
import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentSummary } from "@/lib/services/admin-service";

import {
  blockStudent,
  createStudent,
  deleteStudent,
  revealStudentCode,
  rotateStudentCode,
  updateStudentDataset,
  updateStudentProfile,
} from "../api/student-mutations";
import {
  studentDetailBackRoute,
  studentDetailCloseRoute,
  type StudentDetailBaseRoute,
  type StudentDetailRoute,
} from "../domain/student-detail-route";
import type {
  StudentDetailTab,
  StudentManagementData,
  StudentProfileDraft,
} from "../model";

type DetailState = {
  profile: StudentProfileDraft;
  route: StudentDetailRoute;
};

type DetailAction =
  | { route: StudentDetailRoute; type: "navigate" }
  | { profile: StudentProfileDraft; route: StudentDetailRoute; type: "open" }
  | {
      field: keyof StudentProfileDraft;
      type: "profile";
      value: string;
    };

const emptyProfile: StudentProfileDraft = {
  datasetId: "",
  displayName: "",
  gradeLabel: "",
  schoolName: "",
};

function profileForStudent(student: StudentSummary): StudentProfileDraft {
  return {
    datasetId: student.currentVocabDatasetId ?? "",
    displayName: student.displayName,
    gradeLabel: student.gradeLabel ?? "",
    schoolName: student.schoolName ?? "",
  };
}

function detailReducer(state: DetailState, action: DetailAction): DetailState {
  if (action.type === "navigate") {
    return { ...state, route: action.route };
  }
  if (action.type === "open") {
    return { profile: action.profile, route: action.route };
  }
  return {
    ...state,
    profile: { ...state.profile, [action.field]: action.value },
  };
}

type WrongHistoryCacheEntry = {
  history: StudentWrongWordHistory;
  loadedAt: number;
};

export function useStudentDetailController(data: StudentManagementData) {
  const router = useRouter();
  const initialStudent =
    data.students.find((student) => student.id === data.initialStudentId) ??
    null;
  const [state, dispatch] = useReducer(detailReducer, {
    profile: initialStudent ? profileForStudent(initialStudent) : emptyProfile,
    route: initialStudent
      ? {
          kind: "detail" as const,
          learningView: "summary" as const,
          studentId: initialStudent.id,
          tab: "learning" as const,
        }
      : { kind: "closed" as const },
  });
  const [busyKey, setBusyKey] = useState("");
  const [createError, setCreateError] = useState("");
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [wrongHistoryByStudent, setWrongHistoryByStudent] = useState<
    Record<string, WrongHistoryCacheEntry>
  >({});
  const [, startRefreshTransition] = useTransition();
  const navigationVersionRef = useRef(0);
  const initialStudentIdRef = useRef(data.initialStudentId ?? "");

  const interactionBusy = busyKey !== "" || assignmentBusy;
  const selectedStudentId =
    state.route.kind === "closed" ? "" : state.route.studentId ?? "";
  const selectedStudent =
    data.students.find((student) => student.id === selectedStudentId) ?? null;

  const navigate = useCallback((route: StudentDetailRoute) => {
    navigationVersionRef.current += 1;
    dispatch({ route, type: "navigate" });
  }, []);

  const openStudent = useCallback(
    (student: StudentSummary, tab: StudentDetailTab = "learning") => {
      navigationVersionRef.current += 1;
      dispatch({
        profile: profileForStudent(student),
        route: {
          kind: "detail",
          learningView: "summary",
          studentId: student.id,
          tab,
        },
        type: "open",
      });
    },
    [],
  );

  useEffect(() => {
    const nextId = data.initialStudentId ?? "";
    if (nextId === initialStudentIdRef.current) return;
    initialStudentIdRef.current = nextId;
    const student = data.students.find((candidate) => candidate.id === nextId);
    if (student) openStudent(student);
  }, [data.initialStudentId, data.students, openStudent]);

  function beginAction(key: string) {
    if (interactionBusy) return false;
    setBusyKey(key);
    return true;
  }

  function finishAction() {
    setBusyKey("");
  }

  function refresh() {
    startRefreshTransition(() => router.refresh());
  }

  function closeAll() {
    setAssignmentBusy(false);
    navigate({ kind: "closed" });
  }

  function backOneLevel() {
    navigate(studentDetailBackRoute(state.route));
  }

  function requestClose(reason: DialogCloseReason) {
    if (assignmentBusy) return;
    navigate(studentDetailCloseRoute(state.route, reason));
  }

  function changeTab(tab: StudentDetailTab) {
    if (!selectedStudent) return;
    navigate({
      kind: "detail",
      learningView: "summary",
      studentId: selectedStudent.id,
      tab,
    });
  }

  function openSource(
    view: "vocab" | "passage",
    source: StudentLearningSourceItem,
  ) {
    if (!selectedStudent) return;
    navigate({
      datasetId: source.vocabDatasetId ?? "",
      kind: "source",
      label: source.displayLabel,
      studentId: selectedStudent.id,
      view,
    });
  }

  function openAssignment(datasetId: string) {
    if (!selectedStudent || interactionBusy) return;
    const returnTo: StudentDetailBaseRoute =
      state.route.kind === "source"
        ? state.route
        : {
            kind: "detail",
            learningView: "summary",
            studentId: selectedStudent.id,
            tab: "learning",
          };
    navigate({
      datasetId,
      kind: "assignment",
      returnTo,
      studentId: selectedStudent.id,
    });
  }

  async function createFromForm(formElement: HTMLFormElement) {
    if (!beginAction("create")) return;
    setCreateError("");
    const form = new FormData(formElement);
    try {
      const payload = await createStudent({
        currentVocabDatasetId: form.get("currentVocabDatasetId"),
        displayName: form.get("displayName"),
        gradeLabel: form.get("gradeLabel"),
        note: form.get("note"),
        schoolName: form.get("schoolName"),
      });
      if (!payload.code) {
        throw new Error(adminStudentsText.createStudent.noCodeError);
      }
      navigate({
        code: {
          code: payload.code,
          label: formatContentText(adminStudentsText.createStudent.codeTitle, {
            student: String(form.get("displayName")),
          }),
        },
        kind: "code",
        returnTo: null,
        studentId: null,
      });
      toast.success(adminStudentsText.createStudent.success);
      formElement.reset();
      refresh();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.createStudent.error;
      setCreateError(message);
      toast.error(message);
    } finally {
      finishAction();
    }
  }

  async function saveCurrentDataset() {
    if (!selectedStudent || !beginAction(`vocab:${selectedStudent.id}`)) return;
    try {
      await updateStudentDataset(selectedStudent.id, state.profile.datasetId);
      toast.success(adminStudentsText.account.wordbookSuccess);
      refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.wordbookError,
      );
    } finally {
      finishAction();
    }
  }

  async function saveProfile() {
    if (
      !selectedStudent ||
      !state.profile.displayName.trim() ||
      !beginAction(`profile:${selectedStudent.id}`)
    ) {
      return;
    }
    try {
      await updateStudentProfile(selectedStudent.id, {
        displayName: state.profile.displayName,
        gradeLabel: state.profile.gradeLabel,
        schoolName: state.profile.schoolName,
      });
      toast.success(adminStudentsText.account.profileSuccess);
      refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.profileError,
      );
    } finally {
      finishAction();
    }
  }

  async function revealCode() {
    if (!selectedStudent || !beginAction(`reveal:${selectedStudent.id}`)) return;
    const requestVersion = navigationVersionRef.current;
    const requestStudentId = selectedStudent.id;
    try {
      const payload = await revealStudentCode(requestStudentId);
      if (!payload.code) {
        throw new Error(adminStudentsText.codeModal.missingCodeError);
      }
      if (
        navigationVersionRef.current !== requestVersion ||
        state.route.kind !== "detail" ||
        state.route.studentId !== requestStudentId
      ) {
        return;
      }
      navigate({
        code: {
          code: payload.code,
          label: formatContentText(adminStudentsText.codeModal.revealTitle, {
            student: selectedStudent.displayName,
          }),
        },
        kind: "code",
        returnTo: state.route,
        studentId: requestStudentId,
      });
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.codeModal.revealError,
      );
    } finally {
      finishAction();
    }
  }

  async function rotateCode() {
    if (!selectedStudent) return;
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.rotateConfirm, {
        student: selectedStudent.displayName,
      }),
    );
    if (!accepted || !beginAction(`rotate:${selectedStudent.id}`)) return;
    const requestVersion = navigationVersionRef.current;
    const requestStudentId = selectedStudent.id;
    try {
      const payload = await rotateStudentCode(requestStudentId);
      if (!payload.code) {
        throw new Error(adminStudentsText.createStudent.noCodeError);
      }
      if (
        navigationVersionRef.current !== requestVersion ||
        state.route.kind !== "detail" ||
        state.route.studentId !== requestStudentId
      ) {
        return;
      }
      navigate({
        code: {
          code: payload.code,
          label: formatContentText(adminStudentsText.codeModal.rotateTitle, {
            student: selectedStudent.displayName,
          }),
        },
        kind: "code",
        returnTo: state.route,
        studentId: requestStudentId,
      });
      toast.success(adminStudentsText.account.rotateSuccess);
      refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.rotateError,
      );
    } finally {
      finishAction();
    }
  }

  async function blockAccess() {
    if (!selectedStudent) return;
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.blockConfirm, {
        student: selectedStudent.displayName,
      }),
    );
    if (!accepted || !beginAction(`block:${selectedStudent.id}`)) return;
    try {
      await blockStudent(selectedStudent.id);
      toast.success(adminStudentsText.account.blockSuccess);
      refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.blockError,
      );
    } finally {
      finishAction();
    }
  }

  async function removeStudent() {
    if (!selectedStudent) return;
    const accepted = window.confirm(
      formatContentText(adminStudentsText.account.deleteConfirm, {
        student: selectedStudent.displayName,
      }),
    );
    if (!accepted || !beginAction(`delete:${selectedStudent.id}`)) return;
    try {
      await deleteStudent(selectedStudent.id);
      closeAll();
      toast.success(adminStudentsText.account.deleteSuccess);
      refresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.account.deleteError,
      );
    } finally {
      finishAction();
    }
  }

  const cacheWrongWordHistory = useCallback(
    (studentId: string, history: StudentWrongWordHistory) => {
      setWrongHistoryByStudent((current) => ({
        ...current,
        [studentId]: { history, loadedAt: Date.now() },
      }));
    },
    [],
  );

  const codeActions = useMemo(() => {
    const code = state.route.kind === "code" ? state.route.code : null;
    if (!code) return null;
    const studentAccessUrl = buildStudentAccessUrl(data.appOrigin, code.code);
    const message = [
      code.label,
      formatContentText(adminStudentsText.codeModal.addressLine, {
        url: studentAccessUrl,
      }),
      formatContentText(adminStudentsText.codeModal.codeLine, {
        code: code.code,
      }),
    ].join("\n");
    return {
      copy: async () => {
        await navigator.clipboard.writeText(code.code);
      },
      share: async () => {
        const result = await sendKakaoText({
          message,
          title: code.label,
          url: studentAccessUrl,
        });
        if (result === "sent") return result;
        await navigator.clipboard.writeText(message);
        return result;
      },
    };
  }, [data.appOrigin, state.route]);

  return {
    actions: {
      backOneLevel,
      blockAccess,
      cacheWrongWordHistory,
      changeTab,
      closeAll,
      createFromForm,
      openAssignment,
      openSource,
      openStudent,
      removeStudent,
      requestClose,
      refreshData: refresh,
      revealCode,
      rotateCode,
      saveCurrentDataset,
      saveProfile,
      setAssignmentBusy,
      setProfileField: (field: keyof StudentProfileDraft, value: string) =>
        dispatch({ field, type: "profile", value }),
    },
    assignmentBusy,
    busyKey,
    codeActions,
    createError,
    interactionBusy,
    profile: state.profile,
    route: state.route,
    selectedStudent,
    wrongHistoryByStudent,
  };
}

export type StudentDetailController = ReturnType<
  typeof useStudentDetailController
>;
