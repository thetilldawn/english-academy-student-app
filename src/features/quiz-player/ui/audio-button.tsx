import type { MouseEventHandler } from "react";

import styles from "./audio-button.module.css";

function SpeakerIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M5 9v6h4l5 4V5L9 9H5Z" fill="currentColor" />
      <path
        d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function AudioButton({
  disabled = false,
  label,
  onClick,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  variant: "prompt" | "choice";
}) {
  return (
    <button
      aria-label={label}
      className={[styles.button, styles[variant]].join(" ")}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <SpeakerIcon />
    </button>
  );
}
