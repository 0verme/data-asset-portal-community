import { useTranslation } from "react-i18next";
import { Icon } from "../ui.tsx";

export type ViewMode = "list" | "card" | "group";

interface ViewModeOption {
  value: ViewMode;
  icon: string;
}

const VIEW_MODES: readonly ViewModeOption[] = [
  { value: "list", icon: "list" },
  { value: "card", icon: "grid" },
  { value: "group", icon: "layers" },
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
  const { t } = useTranslation("common");
  const visibleModes = modes
    .map((modeValue) => VIEW_MODES.find((mode) => mode.value === modeValue))
    .filter((mode): mode is ViewModeOption => Boolean(mode));

  return (
    <div className="seg" role="group" aria-label={t("shared.viewMode")}>
      {visibleModes.map((mode) => (
        <button
          key={mode.value}
          className={value === mode.value ? "active" : ""}
          type="button"
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          <Icon name={mode.icon} size={15} />{t(`shared.${mode.value}`)}
        </button>
      ))}
    </div>
  );
}
