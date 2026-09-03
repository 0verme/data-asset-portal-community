import type { InputHTMLAttributes } from "react";

export interface TimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "step" | "className"> {
  className?: string | undefined;
  invalid?: boolean | undefined;
  step?: number | string | undefined;
}

export function TimeInput({
  className = "",
  invalid = false,
  step = 60,
  ...props
}: TimeInputProps) {
  const classes = ["time-input", className, invalid ? "invalid" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      {...props}
      type="time"
      step={step}
      className={classes}
      aria-invalid={invalid || undefined}
    />
  );
}
