"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { adminStudentsText } from "@/content/ko/admin-students";

import type { StudentDetailController } from "../../controller/use-student-detail-controller";
import styles from "../student-detail.module.css";

export function StudentCodePanel({
  controller,
}: {
  controller: StudentDetailController;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const route = controller.route;

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  if (route.kind !== "code" || !controller.codeActions) return null;

  async function copy() {
    if (!controller.codeActions) return;
    try {
      await controller.codeActions.copy();
      setCopied(true);
      toast.success(adminStudentsText.codeModal.copySuccess);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1500);
    } catch {
      toast.error(adminStudentsText.codeModal.copyFailure);
    }
  }

  async function share() {
    if (!controller.codeActions) return;
    try {
      const result = await controller.codeActions.share();
      if (result === "sent") {
        toast.success(adminStudentsText.codeModal.kakaoOpened);
      } else {
        toast.success(
          result === "unconfigured"
            ? adminStudentsText.codeModal.kakaoFallbackUnconfigured
            : adminStudentsText.codeModal.kakaoFallbackFailed,
        );
      }
    } catch {
      toast.error(adminStudentsText.codeModal.kakaoFallbackCopyFailure);
    }
  }

  return (
    <div className={styles.codePanel}>
      <div className={styles.codeValue}>{route.code.code}</div>
      <div className={styles.codeActions}>
        <Button autoFocus onClick={() => void share()} variant="primary">
          {adminStudentsText.codeModal.sendKakao}
        </Button>
        <Button onClick={() => void copy()}>
          {copied
            ? adminStudentsText.codeModal.copied
            : adminStudentsText.codeModal.copy}
        </Button>
      </div>
    </div>
  );
}
