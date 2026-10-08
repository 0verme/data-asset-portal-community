export type ControlSize = "sm" | "md";

export const CONTROL_SIZE_MAP = {
  sm: "sm",
  md: "base",
} as const;

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "outline";

export const BUTTON_VARIANT_MAP = {
  primary: "primary",
  secondary: "secondary",
  tertiary: "ghost",
  danger: "secondary-destructive",
  outline: "outline",
} as const;

export type BadgeTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";

export const BADGE_TONE_MAP = {
  brand: "primary",
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "error",
  info: "info",
} as const;

export type TabAppearance = "line" | "segmented";

export const TAB_APPEARANCE_MAP = {
  line: "underline",
  segmented: "segmented",
} as const;

export type GridColumns = 2 | 3 | 4 | 6;
export type GridDensity = "compact" | "normal" | "spacious";

export const GRID_COLUMNS_MAP = {
  2: "2up",
  3: "3up",
  4: "4up",
  6: "6up",
} as const;

export const GRID_DENSITY_MAP = {
  compact: "sm",
  normal: "base",
  spacious: "lg",
} as const;
