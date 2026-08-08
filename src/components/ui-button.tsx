import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

export type ButtonSize = "small" | "default" | "large" | "icon";
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function buttonClassNames({
  className = "",
  size = "default",
  variant = "secondary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} = {}) {
  return ["button", `button-${variant}`, `button-${size}`, className]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  className = "",
  size = "default",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  const classes = buttonClassNames({ className, size, variant });

  return <button className={classes} type={type} {...props} />;
}

export type ButtonLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function ButtonLink({
  className = "",
  size = "default",
  variant = "secondary",
  ...props
}: ButtonLinkProps) {
  const classes = buttonClassNames({ className, size, variant });

  return <Link className={classes} {...props} />;
}
