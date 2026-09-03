import {
  getBinaryStatusValue,
  normalizeBinaryStatusOptions,
  type BinaryStatusOption,
  type BinaryStatusValue,
} from "./status.ts";

export interface BinaryStatusToggleProps {
  mode?: "status" | "enabled" | undefined;
  value?: unknown;
  options?: readonly BinaryStatusOption[] | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  ariaLabel?: string | undefined;
  onChange?: ((value: BinaryStatusValue | boolean) => void) | undefined;
}

export function BinaryStatusToggle({
  mode = "status",
  value,
  options,
  className = "",
  disabled = false,
  name,
  ariaLabel = "状态选择",
  onChange,
}: BinaryStatusToggleProps) {
  const items = normalizeBinaryStatusOptions(options);
  const currentValue = getBinaryStatusValue(value);
  const wrapperClassName = ["seg", className].filter(Boolean).join(" ");

  const handleChange = (nextValue: BinaryStatusValue) => {
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
