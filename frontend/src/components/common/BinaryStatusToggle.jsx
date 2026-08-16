import React from "react";

import { getBinaryStatusValue, normalizeBinaryStatusOptions } from "./status.js";

export function BinaryStatusToggle({
  mode = "status",
  value,
  options,
  className = "",
  disabled = false,
  name,
  ariaLabel = "状态选择",
  onChange,
}) {
  const items = normalizeBinaryStatusOptions(options);
  const currentValue = getBinaryStatusValue(value);
  const wrapperClassName = ["seg", className].filter(Boolean).join(" ");

  const handleChange = (nextValue) => {
    if (!onChange) return;
    onChange(mode === "enabled" ? nextValue === "enabled" : nextValue);
  };

  return (
    <div className={wrapperClassName} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          className={currentValue === item.value ? "active" : ""}
          type="button"
          name={name}
          disabled={disabled}
          aria-pressed={currentValue === item.value}
          onClick={() => handleChange(item.value)}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}
