"use client";
import { useId } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Input } from "@/design-system/primitives/form/field";
import type { SchoolSearchController } from "../controller/use-school-search";
import styles from "./school-search-field.module.css";

export function SchoolSearchField({ controller }: { controller: SchoolSearchController }) {
  const id = useId();
  return <Field>
    <FieldLabel htmlFor={id}>학교</FieldLabel>
    <Input id={id} name="schoolName" autoComplete="off" maxLength={120} value={controller.value}
      aria-describedby={`${id}-status`} disabled={controller.locked}
      onChange={event => controller.actions.change(event.target.value)} placeholder="학교 이름 검색 또는 직접 입력" />
    <p className={styles.message} id={`${id}-status`} role={controller.status === "error" || controller.locked ? "alert" : controller.status === "idle" ? undefined : "status"}>{controller.message}</p>
    {controller.status === "error" ? <Button onClick={controller.actions.retry} size="small" variant="quiet">다시 검색</Button> : null}
    {controller.items.length ? <ul aria-label="학교 검색 결과" className={styles.results}>
      {controller.items.map(item => <li key={item.id}><Button onClick={() => controller.actions.choose(item.id)} className={styles.result}>
        <strong>{item.name}</strong>{" "}<span>{item.region}</span>
      </Button></li>)}
    </ul> : null}
    {controller.hasMore ? <p className={styles.message}>결과가 더 있습니다. 학교 이름을 더 자세히 입력해 주세요.</p> : null}
  </Field>;
}
