import {
  MIN_SCALE,
  fitTransform,
  fitBoundsTransform,
  focusTransform,
  identityTransform,
  panTransform,
  sanitize,
  zoomAt,
} from "./viewport-math.js";
import type {
  SceneBounds,
  ViewportFitOptions,
  ViewportSize,
  ViewportTransform,
} from "./viewport-types.js";

export class ViewportController {
  private transform: ViewportTransform = identityTransform;
  private baseline: ViewportTransform = identityTransform;
  private viewport: ViewportSize = { width: 0, height: 0 };
  private scene: SceneBounds | null = null;
  private userInteracted = false;
  private minZoomScale = MIN_SCALE;
  constructor(private readonly apply: (transform: ViewportTransform) => void) {}
  setScene(scene: SceneBounds | null, viewport: ViewportSize, fitOnLoad: boolean): void {
    this.scene = scene;
    this.viewport = viewport;
    this.userInteracted = false;
    const initial = fitOnLoad && scene !== null ? fitTransform(scene, viewport) : identityTransform;
    this.baseline = initial ?? identityTransform;
    this.applyFit(this.baseline);
  }
  resize(viewport: ViewportSize, fitOnLoad: boolean): void {
    const previous = this.viewport;
    this.viewport = viewport;
    if (this.scene === null) return;
    if (!this.userInteracted && fitOnLoad) {
      const fit = fitTransform(this.scene, viewport);
      if (fit) {
        this.baseline = fit;
        this.applyFit(fit);
      }
      return;
    }
    if (
      this.userInteracted &&
      previous.width > 0 &&
      previous.height > 0 &&
      viewport.width > 0 &&
      viewport.height > 0
    ) {
      const centerX = (previous.width / 2 - this.transform.translateX) / this.transform.scale;
      const centerY = (previous.height / 2 - this.transform.translateY) / this.transform.scale;
      this.setTransform({
        ...this.transform,
        translateX: viewport.width / 2 - centerX * this.transform.scale,
        translateY: viewport.height / 2 - centerY * this.transform.scale,
      });
    }
  }
  getTransform(): ViewportTransform {
    return { ...this.transform };
  }
  fit(): void {
    if (this.scene) {
      const fit = fitTransform(this.scene, this.viewport);
      if (fit) this.applyFit(fit);
    }
  }
  fitBounds(bounds: SceneBounds, options?: ViewportFitOptions): void {
    const fit = fitBoundsTransform(bounds, this.viewport, options);
    if (fit) this.applyFit(fit);
  }
  reset(): void {
    if (this.scene) {
      this.userInteracted = false;
      this.applyFit(this.baseline);
    }
  }
  focus(center: { x: number; y: number }): void {
    const next = focusTransform(this.transform, this.viewport, center);
    if (next) {
      this.userInteracted = true;
      this.setTransform(next);
    }
  }
  pan(deltaX: number, deltaY: number): void {
    this.userInteracted = true;
    this.setTransform(panTransform(this.transform, deltaX, deltaY));
  }
  zoom(point: { x: number; y: number }, factor: number): void {
    this.userInteracted = true;
    this.setTransform(zoomAt(this.transform, point, factor, this.minZoomScale));
  }
  destroy(): void {
    this.scene = null;
  }
  private applyFit(transform: ViewportTransform): void {
    this.minZoomScale = Math.min(MIN_SCALE, transform.scale);
    this.setTransform(transform);
  }
  private setTransform(value: ViewportTransform): void {
    this.transform = sanitize(value);
    this.apply(this.transform);
  }
}
