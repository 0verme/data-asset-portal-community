import { Button } from "../../ui/index.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { Icon } from "../ui.tsx";

interface ViewModeOption {
  value: ViewMode;
  label: string;
  icon: string;
}

const ASSET_VIEW_MODES: readonly ViewModeOption[] = [
  { value: "list", label: "列表", icon: "list" },
  { value: "card", label: "卡片", icon: "grid" },
  { value: "group", label: "分组", icon: "layers" },
];

export interface AssetViewModeSwitcherProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function AssetViewModeSwitcher({ value, onChange }: AssetViewModeSwitcherProps) {
  return (
    <div className="seg asset-view-mode-switcher" role="group" aria-label="视图切换">
      {ASSET_VIEW_MODES.map((mode) => (
        <Button
          key={mode.value}
          type="button"
          variant="tertiary"
          className={value === mode.value ? "active" : ""}
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
        >
          <Icon name={mode.icon} size={15} />{mode.label}
        </Button>
      ))}
    </div>
  );
}
