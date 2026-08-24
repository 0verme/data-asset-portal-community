
import { Icon } from "../ui.jsx";

const VIEW_MODES = [
  { value: "list", label: "列表", icon: "list" },
  { value: "card", label: "卡片", icon: "grid" },
  { value: "group", label: "分组", icon: "layers" },
];

export function ViewModeSwitcher({ value, onChange, modes = VIEW_MODES.map((mode) => mode.value) }) {
  const visibleModes = modes
    .map((value) => VIEW_MODES.find((mode) => mode.value === value))
    .filter(Boolean);

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
