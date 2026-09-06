"use client";

import { useEffect, useId, useRef } from "react";

import { adminLearningText } from "@/content/ko/admin-learning";
import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";

export function AssignmentDiscardDialog({
  busy,
  onCancel,
  onDiscard,
}: {
  busy: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const text = adminLearningText.discardAssignment;

  useEffect(() => {
    // Let DialogFrame capture the parent focus before moving into this dialog.
    cancelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <DialogFrame
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-title`}
      closeDisabled={busy}
      layout="body-footer"
      onRequestClose={onCancel}
      role="alertdialog"
      size="compact"
    >
      <DialogHeader closeLabel={text.close}>
        <h2 id={`${id}-title`}>{text.title}</h2>
      </DialogHeader>
      <DialogBody>
        <p id={`${id}-description`}>{text.description}</p>
      </DialogBody>
      <DialogFooter>
        <Button disabled={busy} onClick={onCancel} ref={cancelRef}>
          {text.cancel}
        </Button>
        <Button disabled={busy} onClick={onDiscard} variant="danger">
          {text.confirm}
        </Button>
      </DialogFooter>
    </DialogFrame>
  );
}
