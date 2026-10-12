export type FormFieldErrors = Readonly<Record<string, string>>;

/** Later error sources take precedence for a field; empty messages are omitted. */
export function mergeFormFieldErrors(...sources: readonly FormFieldErrors[]): FormFieldErrors {
  const merged = new Map<string, string>();
  for (const source of sources) {
    for (const [field, message] of Object.entries(source)) {
      if (typeof message === "string" && message.trim()) merged.set(field, message);
    }
  }
  return Object.fromEntries(merged);
}

/** Clear one field or a structured field group without touching sibling paths. */
function normalizeFieldPath(field: string): string {
  return field.replace(/\[(\d+)\]/g, ".$1");
}

export function clearFormFieldErrors(errors: FormFieldErrors, field?: string): FormFieldErrors {
  if (field === undefined) return {};
  const prefix = normalizeFieldPath(field.trim());
  if (!prefix) return { ...errors };

  return Object.fromEntries(
    Object.entries(errors).filter(([name]) => {
      const normalizedName = normalizeFieldPath(name);
      return normalizedName !== prefix && !normalizedName.startsWith(`${prefix}.`);
    }),
  );
}

function encodeIdPart(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(16) || "0").join("-") || "empty";
}

export function formFieldElementId(formId: string, field: string): string {
  return `dap-form-${encodeIdPart(formId)}-field-${encodeIdPart(field)}`;
}

export function formErrorSummaryId(formId: string): string {
  return `dap-form-${encodeIdPart(formId)}-error-summary`;
}

const FOCUSABLE_FIELD_SELECTOR = [
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[role='combobox']",
  "[role='checkbox']",
  "[role='switch']",
  "[tabindex]",
  "[contenteditable='true']",
].join(",");

function isFocusable(element: HTMLElement): boolean {
  return element.getAttribute("aria-disabled") !== "true"
    && !element.hasAttribute("disabled")
    && element.getClientRects().length > 0;
}

function findNearestScrollContainer(element: HTMLElement): HTMLElement | null {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const style = window.getComputedStyle(ancestor);
    const canScrollVertically = /(auto|scroll|overlay|hidden)/.test(style.overflowY)
      && ancestor.scrollHeight > ancestor.clientHeight + 1;
    if (canScrollVertically) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function scrollFieldToCenter(target: HTMLElement, behavior: ScrollBehavior): void {
  const targetRect = target.getBoundingClientRect();
  const container = findNearestScrollContainer(target);
  if (container) {
    const containerRect = container.getBoundingClientRect();
    const targetTop = targetRect.top - containerRect.top - container.clientTop + container.scrollTop;
    const centeredOffset = Math.max(0, (container.clientHeight - targetRect.height) / 2);
    const nextTop = clamp(
      targetTop - centeredOffset,
      0,
      Math.max(0, container.scrollHeight - container.clientHeight),
    );
    if (Math.abs(nextTop - container.scrollTop) > 1) {
      if (typeof container.scrollTo === "function") container.scrollTo({ top: nextTop, behavior });
      else container.scrollTop = nextTop;
    }
    return;
  }

  const scrollingElement = document.scrollingElement || document.documentElement;
  const viewportHeight = window.innerHeight || scrollingElement.clientHeight;
  const documentTop = targetRect.top + window.scrollY;
  const centeredOffset = Math.max(0, (viewportHeight - targetRect.height) / 2);
  const nextTop = clamp(
    documentTop - centeredOffset,
    0,
    Math.max(0, scrollingElement.scrollHeight - viewportHeight),
  );
  if (Math.abs(nextTop - window.scrollY) > 1) {
    if (typeof window.scrollTo === "function") window.scrollTo({ top: nextTop, behavior });
    else scrollingElement.scrollTop = nextTop;
  }
}

/** Focus a named field and scroll only its nearest vertical scroll container. */
export function focusFormField(
  form: HTMLElement | null,
  field: string,
  behavior: ScrollBehavior = "smooth",
): boolean {
  if (!form || !field || typeof document === "undefined" || typeof window === "undefined") return false;

  const marker = Array.from(form.querySelectorAll<HTMLElement>("[data-form-field]"))
    .find((element) => element.getAttribute("data-form-field") === field);
  if (!marker) return false;

  const descendants = Array.from(marker.querySelectorAll<HTMLElement>(FOCUSABLE_FIELD_SELECTOR));
  const target = descendants.find(isFocusable)
    || (marker.matches(FOCUSABLE_FIELD_SELECTOR) && isFocusable(marker) ? marker : null)
    || (marker.hasAttribute("tabindex") && marker.getClientRects().length ? marker : null);
  if (!target) return false;

  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
  scrollFieldToCenter(target, behavior);
  return true;
}

export function focusFirstFormError(
  form: HTMLElement | null,
  errors: FormFieldErrors,
  behavior: ScrollBehavior = "smooth",
): boolean {
  const firstField = Object.entries(errors).find(([, message]) => typeof message === "string" && message.trim())?.[0];
  return firstField ? focusFormField(form, firstField, behavior) : false;
}
