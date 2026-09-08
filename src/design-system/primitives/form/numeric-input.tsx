"use client";

import { forwardRef, useId, useState } from "react";
import { FieldError, Input, type InputProps } from "./field";

type NumericInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> & {
  value: number | string | null;
  onValueChange: (value: number | null) => void;
  decimal?: boolean;
};

function externalNumber(value: NumericInputProps["value"]): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseEditingValue(raw: string, decimal: boolean): number | null {
  const pattern = decimal ? /^-?(?:\d+(?:\.\d+)?|\.\d+)$/ : /^-?\d+$/;
  if (!pattern.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

/** Editing text is not a business value: blank/unfinished input stays null, never zero. */
export const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(function NumericInput({
  value, onValueChange, decimal = false, onBlur, required, ...props
}, ref) {
  const errorId = useId();
  const [edit, setEdit] = useState(() => ({
    source: value,
    emitted: externalNumber(value),
    raw: externalNumber(value)?.toString() ?? "",
    touched: false,
  }));
  // Keep text such as 001 while the parent accepts our value; a different external value resets it.
  if (!Object.is(value, edit.source)) {
    const incoming = externalNumber(value);
    const accepted = Object.is(incoming, edit.emitted);
    setEdit({ source: value, emitted: incoming,
      raw: accepted ? edit.raw : incoming?.toString() ?? "",
      touched: accepted && edit.touched });
  }
  const rawValue = Object.is(externalNumber(value), edit.emitted) ? edit.raw : externalNumber(value)?.toString() ?? "";
  const invalid = edit.touched && (rawValue !== "" || required) && parseEditingValue(rawValue, decimal) === null;
  const ownError = invalid && !props["aria-invalid"];

  return <>
    <Input
      {...props}
      aria-invalid={Boolean(props["aria-invalid"] || invalid)}
      aria-errormessage={ownError ? errorId : props["aria-errormessage"]}
      inputMode={decimal ? "decimal" : "numeric"}
      onBlur={(event) => {
        const raw = decimal && /^-?\d+\.$/.test(rawValue) ? rawValue.slice(0, -1) : rawValue;
        const number = parseEditingValue(raw, decimal);
        setEdit({ source: value, emitted: number, raw: number === null ? raw : String(number), touched: true });
        if (!Object.is(number, edit.emitted)) onValueChange(number);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        const number = parseEditingValue(raw, decimal);
        setEdit({ source: value, emitted: number, raw, touched: true });
        onValueChange(number);
      }}
      ref={ref}
      required={required}
      type="text"
      value={rawValue}
    />
    {ownError ? <FieldError id={errorId}>숫자를 입력해 주세요.</FieldError> : null}
  </>;
});
