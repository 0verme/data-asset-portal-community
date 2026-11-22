export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.tabIndex < 0 || element.closest("[inert]") || element.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

export function cycleModalTab(event: Pick<KeyboardEvent, "shiftKey" | "preventDefault">, popup: HTMLElement) {
  const focusable = getFocusableElements(popup);
  if (!focusable.length) {
    event.preventDefault();
    popup.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const activeElement = popup.ownerDocument.activeElement;
  if (event.shiftKey && (activeElement === popup || activeElement === first || !popup.contains(activeElement))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (activeElement === last || !popup.contains(activeElement))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
