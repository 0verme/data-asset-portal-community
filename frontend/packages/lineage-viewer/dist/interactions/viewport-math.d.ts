import type { SceneBounds, ViewportFitOptions, ViewportSize, ViewportTransform } from "./viewport-types.js";
export declare const MIN_SCALE = 0.1;
export declare const MAX_SCALE = 4;
export declare const FIT_PADDING = 24;
export declare const identityTransform: ViewportTransform;
export declare function unionBounds(bounds: readonly SceneBounds[]): SceneBounds | null;
export declare function fitTransform(scene: SceneBounds, viewport: ViewportSize, padding?: number): ViewportTransform | null;
export declare function fitBoundsTransform(scene: SceneBounds, viewport: ViewportSize, options?: ViewportFitOptions): ViewportTransform | null;
export declare function panTransform(transform: ViewportTransform, deltaX: number, deltaY: number): ViewportTransform;
export declare function zoomAt(transform: ViewportTransform, point: {
    x: number;
    y: number;
}, factor: number): ViewportTransform;
export declare function focusTransform(transform: ViewportTransform, viewport: ViewportSize, center: {
    x: number;
    y: number;
}): ViewportTransform | null;
export declare function sanitize(transform: ViewportTransform): ViewportTransform;
//# sourceMappingURL=viewport-math.d.ts.map