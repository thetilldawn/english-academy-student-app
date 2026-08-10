import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import styles from "./button.module.css";

export type ButtonSize = "small" | "default" | "large" | "icon";
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "quiet"
  | "danger"
  | "filter";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function buttonRecipe({
  className = "",
  size = "default",
  variant = "secondary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} = {}) {
  return [
    styles.base,
    size === "default" ? "" : styles[size],
    styles[variant],
    className,
  ]
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
  return (
    <button
      className={buttonRecipe({ className, size, variant })}
      type={type}
      {...props}
    />
  );
}

export type IconButtonProps = Omit<ButtonProps, "aria-label" | "size"> & {
  "aria-label": string;
  shape?: "square" | "circle";
};

export function IconButton({
  className = "",
  shape = "square",
  ...props
}: IconButtonProps) {
  return (
    <Button
      className={[shape === "circle" ? styles.circle : "", className]
        .filter(Boolean)
        .join(" ")}
      size="icon"
      {...props}
    />
  );
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
  return (
    <Link className={buttonRecipe({ className, size, variant })} {...props} />
  );
}

export function ButtonSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={[styles.spinner, className].filter(Boolean).join(" ")}
    />
  );
}
