"use client";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
import { navigateDocument } from "@/components/document-navigation";
import { createRequestDeadline, awaitWithAbortSignal } from "@/lib/network/request-policy";
import { practiceHistoryPageSchema, type PracticeHistoryPage } from "../contracts/practice";
import styles from "../ui/practice.module.css";
export function PracticeHistory({ initial }: { initial: PracticeHistoryPage }) {
  const [page, setPage] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const active = useRef(true), request = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  async function more() {
    if (!page.nextCursor || pending.current) return;
    pending.current = true; setBusy(true); setError(""); request.current = new AbortController();
    const deadline = createRequestDeadline(15000, request.current.signal);
    try {
      const response = await awaitWithAbortSignal(fetch(`/api/student/practice?cursor=${encodeURIComponent(page.nextCursor)}`, { cache: "no-store", signal: deadline.signal }), deadline.signal);
      if ([401, 403, 409].includes(response.status)) {
        if (active.current) {
          setDenied(true); setPage({ items: [], nextCursor: null });
          navigateDocument(response.status === 409 ? "/student/practice" : "/", true);
        }
        return;
      }
      if (!response.ok) throw new Error();
      const next = practiceHistoryPageSchema.parse(await awaitWithAbortSignal(response.json(), deadline.signal));
      if (active.current) setPage(previous => ({ ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))] }));
    } catch { if (active.current) setError("연습 내역을 불러오지 못했습니다."); }
    finally { deadline.dispose(); pending.current = false; if (active.current) setBusy(false); }
  }
  if (denied) return <p role="alert">다시 로그인해 주세요. <ButtonLink href="/">처음으로</ButtonLink></p>;
  return <>
    {!page.items.length ? <p>연습 내역이 없습니다.</p> : <ul className={styles.history}>{page.items.map(item => <li key={item.id}>
      <div><time>{new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(item.startedAt))}</time>
        <p>{item.questionCount}문항 · {item.status === "in_progress" ? "진행 중" : `${item.correctCount}개 정답${item.status === "expired" ? " · 시간 종료" : ""}`}</p></div>
      <ButtonLink href={`/student/practice/${item.id}${item.status === "in_progress" ? "" : "/result"}`} prefetch={false}>{item.status === "in_progress" ? "이어 하기" : "결과"}</ButtonLink>
    </li>)}</ul>}
    {error ? <p role="alert">{error}</p> : null}
    {page.nextCursor ? <Button disabled={busy} onClick={() => void more()}>{busy ? "불러오는 중" : error ? "다시 시도" : "10개 더보기"}</Button> : null}
  </>;
}
