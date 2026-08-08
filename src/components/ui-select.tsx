import type { ComponentPropsWithoutRef } from "react";

export type SelectFieldProps = ComponentPropsWithoutRef<"select">;

export function SelectField({
  children,
  className = "",
  ...props
}: SelectFieldProps) {
  return (
    <select
      className={["select-field", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </select>
  );
}
