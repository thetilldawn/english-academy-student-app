"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../primitives/button/button";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "../../primitives/dialog/dialog";

type ConfirmationOptions = { message: string; title?: string; confirmLabel?: string; signal?: AbortSignal };
type PendingConfirmation = { owner: string; options: ConfirmationOptions; resolve: (accepted: boolean) => void; cleanup: () => void };
type ConfirmationContextValue = {
  request: (owner: string, options: ConfirmationOptions) => Promise<boolean>;
  cancel: (owner: string) => void;
};
const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

/** One visual decision, not a business action. Concurrent and abandoned requests fail closed. */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const settle = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    current.cleanup();
    setPending(null);
    current.resolve(accepted && !current.options.signal?.aborted);
  }, []);
  const request = useCallback((owner: string, options: ConfirmationOptions) => {
    if (pendingRef.current || options.signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const abort = () => settle(false);
      const current = { owner, options, resolve, cleanup: () => options.signal?.removeEventListener("abort", abort) };
      pendingRef.current = current;
      options.signal?.addEventListener("abort", abort, { once: true });
      setPending(current);
    });
  }, [settle]);
  const cancel = useCallback((owner: string) => {
    if (pendingRef.current?.owner === owner) settle(false);
  }, [settle]);
  useLayoutEffect(() => () => {
    const current = pendingRef.current;
    pendingRef.current = null;
    current?.cleanup();
    current?.resolve(false);
  }, []);
  const context = useMemo(() => ({ request, cancel }), [request, cancel]);
  useEffect(() => {
    // DialogFrame must record the underlying editor's focus before this moves it.
    if (pending) cancelRef.current?.focus({ preventScroll: true });
  }, [pending]);
  return <ConfirmationContext.Provider value={context}>
    {children}
    {pending ? <DialogFrame aria-describedby={descriptionId} aria-labelledby={titleId} height="auto" layout="body-footer" onRequestClose={() => settle(false)} size="compact">
      <DialogHeader closeLabel="닫기"><h2 id={titleId}>{pending.options.title ?? "진행할까요?"}</h2></DialogHeader>
      <DialogBody><p id={descriptionId}>{pending.options.message}</p></DialogBody>
      <DialogFooter>
        <Button ref={cancelRef} onClick={() => settle(false)} variant="quiet">취소</Button>
        <Button onClick={() => settle(true)} variant="primary">{pending.options.confirmLabel ?? "확인"}</Button>
      </DialogFooter>
    </DialogFrame> : null}
  </ConfirmationContext.Provider>;
}

export function useConfirmation(scopeKey = "") {
  const context = useContext(ConfirmationContext);
  const id = useId();
  const owner = `${id}:${scopeKey}`;
  useLayoutEffect(() => () => context?.cancel(owner), [context, owner]);
  return useCallback((options: ConfirmationOptions) => context?.request(owner, options) ?? Promise.resolve(false), [context, owner]);
}
