export const DEFAULT_TOAST_DURATION = 3200;

export function resolveToastDuration(duration?: number): number {
  return duration ?? DEFAULT_TOAST_DURATION;
}
