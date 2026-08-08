import type { ComponentPropsWithoutRef } from "react";

export type ButtonSize = "small" | "default" | "large" | "icon";
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  className = "",
  size = "default",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    `button-${variant}`,
    `button-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <button className={classes} type={type} {...props} />;
}
