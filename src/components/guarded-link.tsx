"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { navigateDocument } from "./document-navigation";
import { useGuardedNavigationRequest } from "./navigation-exit-guard";

type GuardedLinkProps = Omit<
  ComponentPropsWithoutRef<typeof Link>,
  "href" | "onNavigate"
> & {
  href: string;
};

/** Uses Next Link navigation while allowing an active editor to confirm exit first. */
export function GuardedLink({
  href,
  replace = false,
  scroll,
  ...props
}: GuardedLinkProps) {
  const requestNavigation = useGuardedNavigationRequest();

  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        const intercepted = requestNavigation(() => {
          navigateDocument(href, replace);
          return true;
        });
        if (intercepted) event.preventDefault();
      }}
      replace={replace}
      scroll={scroll}
    />
  );
}
