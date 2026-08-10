import { ButtonLink } from "@/design-system/primitives/button/button";
import { commonText } from "@/content/ko/common";

export default function NotFoundPage() {
  return (
    <main className="auth-shell" id="main-content">
      <section className="auth-card">
        <p className="eyebrow">404</p>
        <h1>{commonText.notFound.title}</h1>
        <p className="auth-description">
          {commonText.notFound.description}
        </p>
        <ButtonLink href="/" variant="primary">
          {commonText.notFound.home}
        </ButtonLink>
      </section>
    </main>
  );
}
