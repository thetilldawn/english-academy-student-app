import type { ReactNode } from "react";
import styles from "./assignment-study.module.css";

/** A learning aid, not a security boundary: keep geometry and animate only the filter. */
export function StudyBlur({ children, concealed, label, block = false }: {
  children: ReactNode;
  concealed: boolean;
  label: string;
  block?: boolean;
}) {
  const Tag = block ? "div" : "span";
  return <>
    <Tag className={block ? styles.blurBlock : styles.blurInline} data-concealed={concealed}
      aria-hidden={concealed || undefined} inert={concealed}>{children}</Tag>
    {concealed ? <span className={styles.srOnly}>{label}</span> : null}
  </>;
}
