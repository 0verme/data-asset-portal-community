import type {
  SceneBounds,
  ViewportFitOptions,
  ViewportSize,
  ViewportTransform,
} from "./viewport-types.js";

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export const FIT_PADDING = 24;
export const identityTransform: ViewportTransform = { scale: 1, translateX: 0, translateY: 0 };

export function unionBounds(bounds: readonly SceneBounds[]): SceneBounds | null {
  const valid = bounds.filter(validBounds);
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((bound) => bound.x));
  const top = Math.min(...valid.map((bound) => bound.y));
  const right = Math.max(...valid.map((bound) => bound.x + bound.width));
  const bottom = Math.max(...valid.map((bound) => bound.y + bound.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function fitTransform(
  scene: SceneBounds,
  viewport: ViewportSize,
  padding = FIT_PADDING,
): ViewportTransform | null {
  return fitBoundsTransform(scene, viewport, { padding });
}

export function fitBoundsTransform(
  scene: SceneBounds,
  viewport: ViewportSize,
  options: ViewportFitOptions = {},
): ViewportTransform | null {
  if (!validBounds(scene) || !validSize(viewport)) return null;
  const padding = validPadding(options.padding) ? options.padding : FIT_PADDING;
  const availableWidth = viewport.width - 2 * Math.min(padding, viewport.width / 4);
  const availableHeight = viewport.height - 2 * Math.min(padding, viewport.height / 4);
  const scale = clampFitScale(
    Math.min(availableWidth / scene.width, availableHeight / scene.height),
    options,
  );
  if (!validScale(scale)) return null;
  return sanitize({
    scale,
    translateX: (viewport.width - scene.width * scale) / 2 - scene.x * scale,
    translateY: (viewport.height - scene.height * scale) / 2 - scene.y * scale,
  });
}

export function panTransform(
  transform: ViewportTransform,
  deltaX: number,
  deltaY: number,
): ViewportTransform {
  return sanitize({
    ...transform,
    translateX: transform.translateX + deltaX,
    translateY: transform.translateY + deltaY,
  });
}

export function zoomAt(
  transform: ViewportTransform,
  point: { x: number; y: number },
  factor: number,
  minScale = MIN_SCALE,
): ViewportTransform {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(factor) ||
    factor <= 0
  )
    return sanitize(transform);
  const current = sanitize(transform);
  const scale = Math.min(MAX_SCALE, Math.max(Math.min(minScale, current.scale), current.scale * factor));
  if (scale === current.scale) return current;
  const ratio = scale / current.scale;
  return sanitize({
    scale,
    translateX: point.x - (point.x - current.translateX) * ratio,
    translateY: point.y - (point.y - current.translateY) * ratio,
  });
}

export function focusTransform(
  transform: ViewportTransform,
  viewport: ViewportSize,
  center: { x: number; y: number },
): ViewportTransform | null {
  if (!validSize(viewport) || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  return sanitize({
    scale: transform.scale,
    translateX: viewport.width / 2 - center.x * transform.scale,
    translateY: viewport.height / 2 - center.y * transform.scale,
  });
}

export function sanitize(transform: ViewportTransform): ViewportTransform {
  return {
    scale: validScale(transform.scale) ? Math.min(MAX_SCALE, transform.scale) : 1,
    translateX: Number.isFinite(transform.translateX) ? transform.translateX : 0,
    translateY: Number.isFinite(transform.translateY) ? transform.translateY : 0,
  };
}
function clampFitScale(value: number, options: ViewportFitOptions): number {
  const minScale = validScale(options.minScale) ? Math.min(MAX_SCALE, options.minScale) : 0;
  const maxScale = validScale(options.maxScale) ? Math.min(MAX_SCALE, options.maxScale) : MAX_SCALE;
  return Math.max(minScale, Math.min(maxScale, value));
}
function validPadding(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}
function validScale(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
function validSize(value: ViewportSize): boolean {
  return (
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}
function validBounds(value: SceneBounds): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}
