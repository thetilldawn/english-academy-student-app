import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
} from "react";

import styles from "./field.module.css";

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

type FieldProps =
  | (ComponentPropsWithoutRef<"div"> & { as?: "div" })
  | (ComponentPropsWithoutRef<"label"> & { as: "label" });

export function Field(props: FieldProps) {
  if (props.as === "label") {
    const { as: _as, className, ...labelProps } = props;
    void _as;
    return (
      <label className={classNames(styles.field, className)} {...labelProps} />
    );
  }

  const { as: _as, className, ...divProps } = props;
  void _as;
  return <div className={classNames(styles.field, className)} {...divProps} />;
}

type FieldLabelProps =
  | (ComponentPropsWithoutRef<"label"> & { as?: "label" })
  | (ComponentPropsWithoutRef<"span"> & { as: "span" });

export function FieldLabel(props: FieldLabelProps) {
  if (props.as === "span") {
    const { as: _as, className, ...spanProps } = props;
    void _as;
    return (
      <span className={classNames(styles.label, className)} {...spanProps} />
    );
  }

  const { as: _as, className, ...labelProps } = props;
  void _as;
  return (
    <label className={classNames(styles.label, className)} {...labelProps} />
  );
}

export function FieldLabelRow({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames(styles.labelRow, className)} {...props} />;
}

export function FieldRequirement({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={classNames(styles.requirement, className)} {...props} />
  );
}

export function FieldHelp({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={classNames(styles.help, className)} {...props} />;
}

export function FieldError({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={classNames(styles.error, className)}
      role="alert"
      {...props}
    />
  );
}

export type InputProps = ComponentPropsWithoutRef<"input"> & {
  appearance?: "default" | "unstyled";
  leadingAdornment?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    appearance = "default",
    className,
    leadingAdornment = false,
    ...props
  },
  ref,
) {
  return (
    <input
      className={classNames(
        styles.control,
        styles.input,
        appearance === "unstyled" && styles.unstyled,
        leadingAdornment && styles.leadingAdornment,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export type SelectProps = ComponentPropsWithoutRef<"select">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, className, ...props },
  ref,
) {
  return (
    <select
      className={classNames(styles.control, styles.select, className)}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  );
});

export type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        className={classNames(styles.control, styles.textarea, className)}
        ref={ref}
        {...props}
      />
    );
  },
);

export type CheckboxProps = Omit<ComponentPropsWithoutRef<"input">, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <input
        className={classNames(styles.checkbox, className)}
        ref={ref}
        type="checkbox"
        {...props}
      />
    );
  },
);
