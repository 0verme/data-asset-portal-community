import React from "react";

export function TimeInput({
  className = "",
  invalid = false,
  step = 60,
  ...props
}) {
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
