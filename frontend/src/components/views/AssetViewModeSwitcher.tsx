import { useTranslation } from "react-i18next";
import { Button } from "../../ui/index.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { Icon } from "../ui.tsx";

interface ViewModeOption {
  value: ViewMode;
  labelKey: "viewMode.list" | "viewMode.card" | "viewMode.group";
  icon: string;
}

const ASSET_VIEW_MODES: readonly ViewModeOption[] = [
  { value: "list", labelKey: "viewMode.list", icon: "list" },
  { value: "card", labelKey: "viewMode.card", icon: "grid" },
  { value: "group", labelKey: "viewMode.group", icon: "layers" },
];

export interface AssetViewModeSwitcherProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function AssetViewModeSwitcher({ value, onChange }: AssetViewModeSwitcherProps) {
  const { t } = useTranslation("warehouse");
  return (
    <div className="seg asset-view-mode-switcher" role="group" aria-label={t("viewMode.ariaLabel")}>
      {ASSET_VIEW_MODES.map((mode) => (
        <Button
          key={mode.value}
          type="button"
          variant="tertiary"
          className={value === mode.value ? "active" : ""}
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          <Icon name={mode.icon} size={15} />{t(mode.labelKey)}
        </Button>
      ))}
    </div>
  );
}
