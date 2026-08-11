import { ButtonLink } from "@/design-system/primitives/button/button";
import { commonText } from "@/content/ko/common";
import styles from "@/design-system/patterns/auth/auth-layout.module.css";

export default function NotFoundPage() {
  return (
    <main className={styles.authShell} id="main-content">
      <section className={styles.authCard}>
        <p className={styles.eyebrow}>404</p>
        <h1>{commonText.notFound.title}</h1>
        <p className={styles.description}>
          {commonText.notFound.description}
        </p>
        <ButtonLink href="/" variant="primary">
          {commonText.notFound.home}
        </ButtonLink>
      </section>
    </main>
  );
}
