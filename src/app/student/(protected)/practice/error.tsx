"use client";
import { Button, ButtonLink } from "@/design-system/primitives/button/button";
export default function Error({ unstable_retry }: { unstable_retry: () => void }) {
  return <main><p role="alert">연습을 불러오지 못했습니다.</p><Button onClick={unstable_retry}>다시 시도</Button><ButtonLink href="/student/wordbook">내 단어장</ButtonLink></main>;
}
