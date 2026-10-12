export const DEFAULT_TOAST_DURATION = 3200;

export function resolveToastDuration(duration?: number): number {
  return duration ?? DEFAULT_TOAST_DURATION;
}

/** Stable opaque ID lets Kumo refresh an identical toast instead of stacking duplicates. */
export function createToastId(message: string, tone: string): string {
  const value = `${tone}\u0000${message}`;
  let firstHash = 0x811c9dc5;
  let secondHash = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    firstHash = Math.imul(firstHash ^ code, 0x01000193);
    secondHash = Math.imul(secondHash ^ code, 0x85ebca6b);
  }

  return `dap-toast-${(firstHash >>> 0).toString(36)}-${(secondHash >>> 0).toString(36)}`;
}
