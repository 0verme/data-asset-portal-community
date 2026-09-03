import { Icon } from "../ui.tsx";

export type ViewMode = "list" | "card" | "group";

interface ViewModeOption {
  value: ViewMode;
  label: string;
  icon: string;
}

const VIEW_MODES: readonly ViewModeOption[] = [
  { value: "list", label: "列表", icon: "list" },
  { value: "card", label: "卡片", icon: "grid" },
  { value: "group", label: "分组", icon: "layers" },
];

export interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  modes?: readonly ViewMode[] | undefined;
}

export function ViewModeSwitcher({
  value,
  onChange,
  modes = VIEW_MODES.map((mode) => mode.value),
}: ViewModeSwitcherProps) {
  const visibleModes = modes
    .map((modeValue) => VIEW_MODES.find((mode) => mode.value === modeValue))
    .filter((mode): mode is ViewModeOption => Boolean(mode));

  return (
    <div className="seg" aria-label="视图切换">
      {visibleModes.map((mode) => (
        <button
          key={mode.value}
          className={value === mode.value ? "active" : ""}
          type="button"
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          <Icon name={mode.icon} size={15} />{mode.label}
        </button>
      ))}
    </div>
  );
}
