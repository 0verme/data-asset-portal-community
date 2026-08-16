import type { SceneBounds, ViewportFitOptions, ViewportSize, ViewportTransform } from "./viewport-types.js";
export declare class ViewportController {
    private readonly apply;
    private transform;
    private baseline;
    private viewport;
    private scene;
    private userInteracted;
    constructor(apply: (transform: ViewportTransform) => void);
    setScene(scene: SceneBounds | null, viewport: ViewportSize, fitOnLoad: boolean): void;
    resize(viewport: ViewportSize, fitOnLoad: boolean): void;
    getTransform(): ViewportTransform;
    fit(): void;
    fitBounds(bounds: SceneBounds, options?: ViewportFitOptions): void;
    reset(): void;
    focus(center: {
        x: number;
        y: number;
    }): void;
    pan(deltaX: number, deltaY: number): void;
    zoom(point: {
        x: number;
        y: number;
    }, factor: number): void;
    destroy(): void;
    private setTransform;
}
//# sourceMappingURL=viewport-controller.d.ts.map